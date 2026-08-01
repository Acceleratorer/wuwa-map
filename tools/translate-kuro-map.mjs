import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectKuroTexts,
  hasHanText,
  loadKuroTranslations,
  localizeKuroCatalog,
  localizeKuroMapPack,
} from "./kuro-localization.mjs";

const TRANSLATE_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single";
const BING_TRANSLATOR_PAGE =
  "https://www.bing.com/translator?from=zh-Hans&to=vi";
const BING_TRANSLATE_ENDPOINT =
  "https://www.bing.com/ttranslatev3";
const BING_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36";
const TRANSLATION_DELIMITER = "__WUWA_TRANSLATION_SPLIT_7E3A__";
const DEFAULT_BATCH_CHARACTERS = 3_500;
const DEFAULT_BATCH_ITEMS = 32;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_REQUEST_DELAY = 800;
let fallbackProviderActive = false;
let bingSessionPromise;
let bingRequestId = 0;

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Tham số CLI không hợp lệ.");
    }
    values.set(name, value);
  }
  return values;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} phải là số nguyên dương.`);
  }
  return parsed;
}

function booleanArgument(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("Giá trị boolean phải là true hoặc false.");
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sortedTranslations(translations) {
  return Object.fromEntries(
    [...translations].sort(([left], [right]) =>
      left.localeCompare(right, "zh-CN"),
    ),
  );
}

function readMapPacks(inputDirectory) {
  const mapsDirectory = join(inputDirectory, "maps");
  return readdirSync(mapsDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .map((name) => {
      const path = join(mapsDirectory, name);
      return {
        path,
        pack: JSON.parse(readFileSync(path, "utf8")),
      };
    });
}

function createBatches(texts, maxCharacters, maxItems) {
  const batches = [];
  let current = [];
  let currentCharacters = 0;
  for (const text of texts) {
    const addedCharacters =
      text.length + (current.length > 0 ? TRANSLATION_DELIMITER.length + 2 : 0);
    if (
      current.length > 0 &&
      (
        current.length >= maxItems ||
        currentCharacters + addedCharacters > maxCharacters
      )
    ) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(text);
    currentCharacters += addedCharacters;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function fetchTranslation(text, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const requestValues = {
        client: "gtx",
        sl: "zh-CN",
        tl: "vi",
        dt: "t",
        q: text,
      };
      let response = await fetch(TRANSLATE_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "WayfinderMap/0.1 translation-cache-builder",
        },
        body: new URLSearchParams(requestValues),
      });
      if (response.status === 405) {
        const fallbackUrl = new URL(TRANSLATE_ENDPOINT);
        for (const [name, value] of Object.entries(requestValues)) {
          fallbackUrl.searchParams.set(name, value);
        }
        response = await fetch(fallbackUrl, {
          signal: AbortSignal.timeout(30_000),
          headers: {
            "user-agent": "WayfinderMap/0.1 translation-cache-builder",
          },
        });
      }
      if (!response.ok) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const error = new Error(`${response.status} ${response.statusText}`);
        error.status = response.status;
        error.retryAfterMs = Number.isFinite(retryAfterSeconds)
          ? Math.max(1_000, retryAfterSeconds * 1_000)
          : response.status === 429
            ? 5_000 * attempt
            : 0;
        throw error;
      }
      const payload = await response.json();
      const translated = payload?.[0]
        ?.map((part) => part?.[0] ?? "")
        .join("");
      if (typeof translated !== "string" || translated.trim().length === 0) {
        throw new Error("Dịch vụ không trả về nội dung.");
      }
      return translated;
    } catch (error) {
      lastError = error;
      if ([400, 413, 414, 429].includes(error?.status)) {
        throw error;
      }
      if (attempt < attempts) {
        const retryAfterMs =
          typeof error?.retryAfterMs === "number" ? error.retryAfterMs : 0;
        await sleep(
          Math.min(
            45_000,
            Math.max(retryAfterMs, 700 * 2 ** (attempt - 1)),
          ),
        );
      }
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String(lastError));
}

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
  }
  return response.headers.get("set-cookie") ?? "";
}

async function createBingSession() {
  const response = await fetch(BING_TRANSLATOR_PAGE, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      "user-agent": BING_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Không mở được Bing Translator: ${response.status} ${response.statusText}`,
    );
  }
  const html = await response.text();
  const ig = /IG:\"([^\"]+)/.exec(html)?.[1];
  const iid = /data-iid="([^"]+)/.exec(html)?.[1];
  const auth =
    /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/
      .exec(html);
  if (!ig || !iid || !auth) {
    throw new Error("Không đọc được token Bing Translator.");
  }
  return {
    ig,
    iid,
    key: auth[1],
    token: auth[2],
    cookies: responseCookies(response),
  };
}

function getBingSession(refresh = false) {
  if (refresh || !bingSessionPromise) {
    bingSessionPromise = createBingSession();
  }
  return bingSessionPromise;
}

async function fetchFallbackBatch(batch, attempts = 4) {
  const joined = batch.join(`\n${TRANSLATION_DELIMITER}\n`);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const session = await getBingSession(attempt > 1);
      bingRequestId += 1;
      const endpoint =
        `${BING_TRANSLATE_ENDPOINT}?isVertical=1&&IG=${session.ig}` +
        `&IID=${session.iid}.${bingRequestId}`;
      const response = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://www.bing.com",
          referer: BING_TRANSLATOR_PAGE,
          cookie: session.cookies,
          "user-agent": BING_USER_AGENT,
        },
        body: new URLSearchParams({
          fromLang: "zh-Hans",
          text: joined,
          to: "vi",
          token: session.token,
          key: session.key,
        }),
      });
      const payload = await response.json();
      const translated = payload?.[0]?.translations?.[0]?.text;
      if (
        !response.ok ||
        typeof translated !== "string" ||
        translated.trim().length === 0
      ) {
        const error = new Error(
          `${response.status} ${response.statusText}`,
        );
        error.status = response.status;
        throw error;
      }
      const parts = translated
        .split(TRANSLATION_DELIMITER)
        .map((part) => part.trim());
      if (
        parts.length !== batch.length ||
        parts.some((part) => part.length === 0)
      ) {
        throw new Error("Bing Translator làm mất delimiter của batch.");
      }
      return parts;
    } catch (error) {
      lastError = error;
      if ([400, 413, 414].includes(error?.status)) {
        throw error;
      }
      if (attempt < attempts) {
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String(lastError));
}

async function translateFallbackBatch(batch) {
  const joinedLength = batch.reduce(
    (total, text, index) =>
      total +
      text.length +
      (index > 0 ? TRANSLATION_DELIMITER.length + 2 : 0),
    0,
  );
  if (batch.length > 1 && joinedLength > 900) {
    const midpoint = Math.ceil(batch.length / 2);
    const left = await translateFallbackBatch(batch.slice(0, midpoint));
    const right = await translateFallbackBatch(batch.slice(midpoint));
    return [...left, ...right];
  }
  try {
    return await fetchFallbackBatch(batch);
  } catch (error) {
    if (batch.length === 1) {
      throw error;
    }
    const midpoint = Math.ceil(batch.length / 2);
    const left = await translateFallbackBatch(batch.slice(0, midpoint));
    const right = await translateFallbackBatch(batch.slice(midpoint));
    return [...left, ...right];
  }
}

async function translateBatch(batch) {
  if (fallbackProviderActive) {
    return translateFallbackBatch(batch);
  }
  const joined = batch.join(`\n${TRANSLATION_DELIMITER}\n`);
  let translated;
  try {
    translated = await fetchTranslation(joined);
  } catch (error) {
    if (error?.status === 429) {
      fallbackProviderActive = true;
      console.warn(
        "Google Translate đang rate-limit; chuyển sang Bing cho phần còn lại.",
      );
      return translateFallbackBatch(batch);
    }
    if (
      batch.length > 1 &&
      [400, 413, 414].includes(error?.status)
    ) {
      const midpoint = Math.ceil(batch.length / 2);
      const [left, right] = await Promise.all([
        translateBatch(batch.slice(0, midpoint)),
        translateBatch(batch.slice(midpoint)),
      ]);
      return [...left, ...right];
    }
    throw error;
  }
  const parts = translated
    .split(TRANSLATION_DELIMITER)
    .map((part) => part.trim());
  if (
    parts.length === batch.length &&
    parts.every((part) => part.length > 0)
  ) {
    return parts;
  }
  if (batch.length === 1) {
    return [translated.trim()];
  }
  const midpoint = Math.ceil(batch.length / 2);
  const [left, right] = await Promise.all([
    translateBatch(batch.slice(0, midpoint)),
    translateBatch(batch.slice(midpoint)),
  ]);
  return [...left, ...right];
}

async function translateBatches(
  batches,
  concurrency,
  requestDelay,
  onBatch,
) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < batches.length) {
      const index = nextIndex;
      nextIndex += 1;
      const batch = batches[index];
      const translated = await translateBatch(batch);
      await onBatch(index, batch, translated);
      if (requestDelay > 0) {
        await sleep(requestDelay);
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, batches.length) },
      () => worker(),
    ),
  );
}

function printUsage() {
  console.log("Usage:");
  console.log(
    "  pnpm translate:kuro --input public/map-packs/private " +
      "[--translations tools/kuro-map-translations.vi.json]",
  );
  console.log(
    "    [--include-descriptions true|false] [--apply true|false] " +
      "[--retry-untranslated true|false] " +
      "[--concurrency 1] [--request-delay 800] " +
      "[--batch-characters 3500] [--batch-items 32]",
  );
}

async function main() {
  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }

  const argumentsMap = parseArguments(process.argv.slice(2));
  const inputDirectory = resolve(
    argumentsMap.get("--input") ?? "public/map-packs/private",
  );
  const translationsPath = resolve(
    argumentsMap.get("--translations") ??
      "tools/kuro-map-translations.vi.json",
  );
  const includeDescriptions = booleanArgument(
    argumentsMap.get("--include-descriptions"),
    true,
  );
  const apply = booleanArgument(argumentsMap.get("--apply"), true);
  const retryUntranslated = booleanArgument(
    argumentsMap.get("--retry-untranslated"),
    false,
  );
  const concurrency = positiveInteger(
    argumentsMap.get("--concurrency") ?? DEFAULT_CONCURRENCY,
    "concurrency",
  );
  const requestDelay = positiveInteger(
    argumentsMap.get("--request-delay") ?? DEFAULT_REQUEST_DELAY,
    "requestDelay",
  );
  const maxCharacters = positiveInteger(
    argumentsMap.get("--batch-characters") ?? DEFAULT_BATCH_CHARACTERS,
    "batchCharacters",
  );
  const maxItems = positiveInteger(
    argumentsMap.get("--batch-items") ?? DEFAULT_BATCH_ITEMS,
    "batchItems",
  );

  const entries = readMapPacks(inputDirectory);
  const translations = loadKuroTranslations(translationsPath);
  const texts = collectKuroTexts(
    entries.map((entry) => entry.pack),
    { includeDescriptions },
  );
  const pending = texts.filter((text) => {
    const existing = translations.get(text);
    return (
      existing === undefined ||
      (retryUntranslated && hasHanText(existing))
    );
  });
  const batches = createBatches(pending, maxCharacters, maxItems);

  console.log(
    `${texts.length} chuỗi tiếng Trung, ${pending.length} chuỗi cần dịch, ` +
      `${batches.length} batch.`,
  );

  let completed = 0;
  await translateBatches(
    batches,
    concurrency,
    requestDelay,
    async (_index, batch, translated) => {
      for (let index = 0; index < batch.length; index += 1) {
        translations.set(batch[index], translated[index]);
      }
      completed += 1;
      if (completed % 10 === 0 || completed === batches.length) {
        writeJson(translationsPath, {
          schemaVersion: 1,
          sourceLanguage: "zh-CN",
          targetLanguage: "vi",
          translations: sortedTranslations(translations),
        });
        console.log(`Đã dịch ${completed}/${batches.length} batch.`);
      }
    },
  );

  if (batches.length === 0) {
    writeJson(translationsPath, {
      schemaVersion: 1,
      sourceLanguage: "zh-CN",
      targetLanguage: "vi",
      translations: sortedTranslations(translations),
    });
  }

  if (apply) {
    for (const entry of entries) {
      writeJson(
        entry.path,
        localizeKuroMapPack(entry.pack, translations),
      );
    }
    const catalogPath = join(inputDirectory, "catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    writeJson(
      catalogPath,
      localizeKuroCatalog(catalog, translations),
    );
    console.log(`Đã áp bản dịch vào ${entries.length} map pack.`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
