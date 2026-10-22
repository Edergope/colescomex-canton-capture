// Ciudades y provincias chinas frecuentes entre expositores de la Feria de Cantón.
// Solo se reconocen si el nombre aparece EXPLÍCITAMENTE en el texto (no se infiere la provincia por la ciudad).
export const PROVINCES: [en: string, cn: string][] = [
  ['Guangdong', '广东'], ['Zhejiang', '浙江'], ['Jiangsu', '江苏'], ['Fujian', '福建'], ['Shandong', '山东'], ['Hebei', '河北'],
  ['Henan', '河南'], ['Hubei', '湖北'], ['Hunan', '湖南'], ['Anhui', '安徽'], ['Jiangxi', '江西'], ['Sichuan', '四川'],
  ['Guangxi', '广西'], ['Yunnan', '云南'], ['Guizhou', '贵州'], ['Shaanxi', '陕西'], ['Shanxi', '山西'], ['Liaoning', '辽宁'],
  ['Jilin', '吉林'], ['Heilongjiang', '黑龙江'], ['Hainan', '海南'], ['Gansu', '甘肃'], ['Qinghai', '青海'], ['Inner Mongolia', '内蒙古'],
  ['Ningxia', '宁夏'], ['Xinjiang', '新疆'], ['Tibet', '西藏'], ['Beijing', '北京'], ['Shanghai', '上海'], ['Tianjin', '天津'],
  ['Chongqing', '重庆'], ['Hong Kong', '香港'], ['Macau', '澳门'], ['Taiwan', '台湾'],
];
export const CITIES: [en: string, cn: string][] = [
  ['Guangzhou', '广州'], ['Shenzhen', '深圳'], ['Foshan', '佛山'], ['Dongguan', '东莞'], ['Zhongshan', '中山'], ['Jiangmen', '江门'],
  ['Huizhou', '惠州'], ['Shantou', '汕头'], ['Chaozhou', '潮州'], ['Jieyang', '揭阳'], ['Zhuhai', '珠海'], ['Zhaoqing', '肇庆'], ['Qingyuan', '清远'],
  ['Yiwu', '义乌'], ['Ningbo', '宁波'], ['Hangzhou', '杭州'], ['Wenzhou', '温州'], ['Taizhou', '台州'], ['Jinhua', '金华'], ['Shaoxing', '绍兴'],
  ['Huzhou', '湖州'], ['Jiaxing', '嘉兴'], ['Yongkang', '永康'], ['Suzhou', '苏州'], ['Wuxi', '无锡'], ['Changzhou', '常州'], ['Nanjing', '南京'],
  ['Nantong', '南通'], ['Yangzhou', '扬州'], ['Xiamen', '厦门'], ['Quanzhou', '泉州'], ['Fuzhou', '福州'], ['Jinjiang', '晋江'], ['Putian', '莆田'],
  ['Zhangzhou', '漳州'], ['Qingdao', '青岛'], ['Jinan', '济南'], ['Yantai', '烟台'], ['Weifang', '潍坊'], ['Linyi', '临沂'], ['Zibo', '淄博'],
  ['Shijiazhuang', '石家庄'], ['Baoding', '保定'], ['Zhengzhou', '郑州'], ['Wuhan', '武汉'], ['Changsha', '长沙'], ['Hefei', '合肥'],
  ['Nanchang', '南昌'], ['Chengdu', '成都'], ['Kunming', '昆明'], ['Nanning', '南宁'], ['Xi\'an', '西安'], ['Shenyang', '沈阳'], ['Dalian', '大连'],
  ['Beijing', '北京'], ['Shanghai', '上海'], ['Tianjin', '天津'], ['Chongqing', '重庆'], ['Hong Kong', '香港'],
];

const MUNICIPALITIES = new Set(['Beijing', 'Shanghai', 'Tianjin', 'Chongqing', 'Hong Kong']);

function firstMatch(text: string, table: [string, string][], cnSuffix: RegExp): { name: string; at: number } | undefined {
  let best: { name: string; at: number } | undefined;
  for (const [en, cn] of table) {
    const reEn = new RegExp(`\\b${en.replace("'", "'?")}\\b`, 'i');
    const mEn = text.match(reEn);
    const iCn = text.search(new RegExp(cn + cnSuffix.source));
    const at = Math.min(mEn?.index ?? Infinity, iCn >= 0 ? iCn : Infinity);
    if (at !== Infinity && (!best || at < best.at)) best = { name: en, at };
  }
  return best;
}

export function findPlaces(text: string): { city?: string; province?: string } {
  if (!text) return {};
  let city: { name: string; at: number } | undefined = firstMatch(text, CITIES, /(市)?/);
  const province = firstMatch(text, PROVINCES.filter(([en]) => !MUNICIPALITIES.has(en) || !city || city.name !== en), /(省|壮族自治区|自治区)?/);
  // Ciudad explícita fuera de la tabla: "Cixi City" / "慈溪市" (se toma el nombre tal como está impreso)
  if (!city) {
    const en = text.match(/\b([A-Z][a-z]{2,})\s+City\b/);
    const cn = text.match(/(?:省|自治区)?([\u4e00-\u9fff]{2,3}?)市/);
    const cand = [en && { name: en[1], at: en.index! }, cn && !PROVINCES.some(([, p]) => cn[1].includes(p)) && { name: cn[1], at: cn.index! }]
      .filter(Boolean) as { name: string; at: number }[];
    city = cand.sort((a, b) => a.at - b.at)[0];
  }
  return { city: city?.name, province: province && province.name !== city?.name ? province.name : undefined };
}
