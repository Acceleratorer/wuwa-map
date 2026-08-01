import { existsSync, readFileSync } from "node:fs";

const HAN_TEXT_PATTERN = /[\u3400-\u9fff]/u;
const MANUAL_TRANSLATIONS = new Map([
  ["Sân băng Roy", "Băng nguyên Roya"],
  [
    "Uylon, Quần đảo Darkshore, Tháp Linasi, Sân băng Roy",
    "Hoàng Long, Quần đảo Bờ Đen, Rinascita và Băng nguyên Roya",
  ],
  ["Đáy Tatis", "Vực sâu Tethys"],
  ["hầm dưới", "Kho bạc ngầm"],
  ["Avinulin", "Avinoleum"],
  ["Bãi thử nghiệm biển ẩn", "Bãi thử Biển Ẩn"],
  ["đồng bằng tối", "Đồng bằng Dimmr"],
  ["thành phố lãng phí khe thời gian", "Đô thị Chronorift"],
  [
    "Tầng 1 · Trong cánh cửa bên cạnh Hắc Thạch có 蚀岩蝶, đi thẳng từ điểm truyền tống vào lỗ hổng nhỏ bên trái (góc dưới bên trái bản đồ nhỏ), sau khi vào lỗ hổng nhìn lên bên trái để vào cửa hang, kích hoạt Truy Lưu Dụ, mở cửa bên trái, dùng Hắc Thạch mở khóa 蚀岩蝶, sau đó đi thẳng về phía điểm truyền tống, đến vị trí hình hai, mở cửa mở rương, xong.",
    "Tầng 1 · Trong cánh cửa bên cạnh Hắc Thạch có Bướm Xói Đá. Đi thẳng từ điểm truyền tống vào lỗ hổng nhỏ bên trái (góc dưới bên trái bản đồ nhỏ), sau khi vào hang hãy nhìn lên bên trái, kích hoạt Truy Lưu Dụ, mở cửa trái, dùng Hắc Thạch mở khóa Bướm Xói Đá, rồi đi về phía điểm truyền tống. Đến vị trí hình hai, mở cửa và lấy rương.",
  ],
  [
    "Tầng 13 · Phương pháp trốn học nhanh: Ở vị trí hình 2, dùng Colette hoặc các cô gái khác chui qua khe hở bên trái của phòng giam (như khung màu xanh trong hình 2) là có thể nhận được (dấu chấm câu do người chơi silent và 星玖onlive cung cấp)",
    "Tầng 13 · Cách đi tắt: tại vị trí hình 2, dùng Colette hoặc nhân vật nhỏ người chui qua khe bên trái phòng giam (khung xanh trong hình 2) để lấy. Vị trí do người chơi silent và XingjiuOnLive cung cấp.",
  ],
  [
    "Tầng 13 · Trong hang tầng 2 ngầm (dấu chấm do người chơi 星玖onlive cung cấp)",
    "Tầng 13 · Trong hang ở tầng ngầm thứ hai. Vị trí do người chơi XingjiuOnLive cung cấp.",
  ],
  [
    "Tầng 15 · Tầng 3, trước tượng, có thể dùng角 bay tới",
    "Tầng 15 · Ở tầng 3, phía trước bức tượng; có thể dùng Jué bay tới.",
  ],
  [
    "Tầng 22 · Rương báu trên bản đồ ngầm Trung tâm Tích Năng, tôi khuyên mọi người nên lấy trực tiếp khi làm cốt truyện, khi trong cốt truyện điều khiển riêng Floro, sau khi đi qua ống thông gió giống như một lối đi, trong căn phòng ra khỏi ống thông gió. Điểm dịch chuyển xem hình 2. (Cảm ơn người chơi “三顾喵房” đã cung cấp hình ảnh.)",
    "Tầng 22 · Rương trên bản đồ ngầm Trung tâm Tích Năng. Nên lấy ngay khi làm cốt truyện: lúc điều khiển riêng Floro, đi qua đường ống thông gió và vào căn phòng ở đầu ra. Điểm dịch chuyển xem hình 2. Cảm ơn người chơi SanguMiaofang đã cung cấp ảnh.",
  ],
  [
    "Tầng 22 · Rương báu trên bản đồ ngầm Trung tâm tích năng, tôi khuyên mọi người nên lấy trực tiếp trong khi làm cốt truyện, điểm dịch chuyển xem hình 2. (Cảm ơn người chơi “三顾喵房” đã cung cấp hình ảnh.)",
    "Tầng 22 · Rương trên bản đồ ngầm Trung tâm Tích Năng. Nên lấy ngay khi làm cốt truyện; điểm dịch chuyển xem hình 2. Cảm ơn người chơi SanguMiaofang đã cung cấp ảnh.",
  ],
  [
    "Tầng 22 · Rương báu vật trên bản đồ ngầm Trung tâm tích năng, tôi khuyên mọi người nên lấy trực tiếp khi làm cốt truyện, khi điều khiển riêng nhân vật, có thể gặp khi hỗ trợ Floro đi qua hành lang. Điểm dịch chuyển xem hình 2. (Cảm ơn người chơi “三顾喵房” đã cung cấp hình ảnh.)",
    "Tầng 22 · Rương trên bản đồ ngầm Trung tâm Tích Năng. Nên lấy ngay khi làm cốt truyện; có thể gặp khi điều khiển nhân vật hỗ trợ Floro đi qua hành lang. Điểm dịch chuyển xem hình 2. Cảm ơn người chơi SanguMiaofang đã cung cấp ảnh.",
  ],
  [
    "Tầng 43 · Đồng Băng Roy - Rừng N悬 hài Ngày - Cây Ngày Thứ Tư · tầng một",
    "Tầng 43 · Băng nguyên Roya – Rừng Ngày Treo – Cây Ngày Thứ Tư · tầng một",
  ],
  [
    "Tầng 6 · Có thể nhận được sau khi tắt đúng máy tính trong nhiệm vụ Ranh giới suy diễn, có thể tham khảo hướng dẫn tương ứng (dấu câu do người chơi 星玖onlive cung cấp)",
    "Tầng 6 · Nhận được sau khi tắt đúng máy tính trong nhiệm vụ Ranh Giới Suy Diễn; có thể tham khảo hướng dẫn tương ứng. Vị trí do người chơi XingjiuOnLive cung cấp.",
  ],
]);

export function hasHanText(value) {
  return typeof value === "string" && HAN_TEXT_PATTERN.test(value);
}

export function loadKuroTranslations(path) {
  if (!path || !existsSync(path)) {
    return new Map(MANUAL_TRANSLATIONS);
  }
  const payload = JSON.parse(readFileSync(path, "utf8"));
  if (
    payload?.schemaVersion !== 1 ||
    payload?.sourceLanguage !== "zh-CN" ||
    payload?.targetLanguage !== "vi" ||
    typeof payload?.translations !== "object" ||
    payload.translations === null ||
    Array.isArray(payload.translations)
  ) {
    throw new Error(`File bản dịch KURO không hợp lệ: ${path}`);
  }
  return new Map([
    ...Object.entries(payload.translations).filter(
      ([source, translation]) =>
        source.trim().length > 0 &&
        typeof translation === "string" &&
        translation.trim().length > 0,
    ),
    ...MANUAL_TRANSLATIONS,
  ]);
}

export function localizeKuroText(value, translations) {
  if (typeof value !== "string") {
    return value;
  }
  let localized = value;
  const seen = new Set([localized]);
  for (let depth = 0; depth < 4; depth += 1) {
    const next = translations.get(localized);
    if (!next || seen.has(next)) {
      break;
    }
    localized = next;
    seen.add(localized);
  }
  return localized;
}

export function collectKuroTexts(
  packs,
  { includeDescriptions = true } = {},
) {
  const values = new Set();
  const add = (value) => {
    if (hasHanText(value)) {
      values.add(value);
    }
  };

  for (const pack of packs) {
    add(pack.title);
    add(pack.subtitle);
    for (const group of pack.categoryGroups ?? []) {
      add(group.label);
    }
    for (const category of pack.categories ?? []) {
      add(category.label);
    }
    for (const layer of pack.layers ?? []) {
      add(layer.label);
      add(layer.groupLabel);
    }
    for (const marker of pack.markers ?? []) {
      add(marker.title);
      if (includeDescriptions) {
        add(marker.description);
      }
    }
  }

  return [...values].sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
}

export function localizeKuroMapPack(pack, translations) {
  return {
    ...pack,
    title: localizeKuroText(pack.title, translations),
    subtitle: localizeKuroText(pack.subtitle, translations),
    categoryGroups: pack.categoryGroups?.map((group) => ({
      ...group,
      label: localizeKuroText(group.label, translations),
    })),
    categories: pack.categories.map((category) => ({
      ...category,
      label: localizeKuroText(category.label, translations),
    })),
    layers: pack.layers?.map((layer) => ({
      ...layer,
      label: localizeKuroText(layer.label, translations),
      groupLabel: localizeKuroText(layer.groupLabel, translations),
    })),
    markers: pack.markers.map((marker) => ({
      ...marker,
      title: localizeKuroText(marker.title, translations),
      description: localizeKuroText(marker.description, translations),
    })),
  };
}

export function localizeKuroCatalog(catalog, translations) {
  return {
    ...catalog,
    maps: catalog.maps.map((entry) => ({
      ...entry,
      title: localizeKuroText(entry.title, translations),
    })),
  };
}
