// Tarjetas de prueba (empresas ficticias) con verdad de referencia por cara.
// `expect`: campos visibles en ESA imagen; un array = cualquiera de los valores es correcto.
export const CARDS = [
  {
    id: 'c1', side: 'front', style: 'light',
    html: `
<div class="logo">明亮</div>
<div class="cn big">广州市明亮照明科技有限公司</div>
<div class="en">GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.</div>
<div class="row"><b class="cn">王伟</b> <span class="cn">销售经理</span></div>
<div class="row"><b>Jason Wang</b> Sales Manager</div>
<div class="sm">Tel: +86-20-8888 6666 &nbsp; Fax: +86-20-8888 6667</div>
<div class="sm">Mob/WeChat/WhatsApp: +86 138 0013 8000</div>
<div class="sm">E-mail: jason@brightlighting.com.cn</div>
<div class="sm">Web: www.brightlighting.com.cn</div>
<div class="sm">Add: No. 18 Huangpu Road, Baiyun District, Guangzhou, China</div>`,
    expect: {
      company_name: 'GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.', company_name_cn: '广州市明亮照明科技有限公司',
      contact_name: ['王伟', 'Jason Wang'], phone_1: '+8613800138000', phone_2: '+862088886666', email: 'jason@brightlighting.com.cn',
      website: 'www.brightlighting.com.cn', wechat: '+8613800138000', whatsapp: '+8613800138000', city: 'Guangzhou',
    },
  },
  {
    id: 'c1', side: 'back', style: 'light',
    html: `
<div class="cn big">广州市明亮照明科技有限公司</div>
<div class="cn">主营产品：LED灯带、面板灯、筒灯、户外泛光灯</div>
<div class="cn">地址：广东省广州市白云区黄埔路18号</div>
<div class="cn">电话：020-8888 6666</div>
<div class="cn">展位号：11.2C15</div>`,
    expect: { company_name_cn: '广州市明亮照明科技有限公司', phone_1: '+862088886666', hall: '11.2', booth: 'C15', province: 'Guangdong', city: 'Guangzhou' },
  },
  {
    id: 'c2', side: 'front', style: 'light serif',
    html: `
<div class="en big">NINGBO OCEAN IMP. &amp; EXP. CO., LTD.</div>
<div class="rule"></div>
<div class="en">Tony Li</div>
<div class="sm">Export Manager</div>
<div class="sm">M: +86 139 5744 1234</div>
<div class="sm">T: +86 574 8765 4321</div>
<div class="sm">E: tony@ocean-nb.com</div>
<div class="sm">W: www.ocean-nb.com</div>
<div class="sm">Room 1205, Tianan Building, Yinzhou District, Ningbo, China</div>`,
    expect: {
      company_name: 'NINGBO OCEAN IMP. & EXP. CO., LTD.', contact_name: 'Tony Li', phone_1: '+8613957441234', phone_2: '+8657487654321',
      email: 'tony@ocean-nb.com', website: 'www.ocean-nb.com', city: 'Ningbo',
    },
  },
  {
    id: 'c2', side: 'back', style: 'light',
    html: `
<div class="cn big">宁波海洋进出口有限公司</div>
<div class="cn">李涛 外贸经理</div>
<div class="cn">手机：13957441234</div>
<div class="cn">微信：tonyli_nb</div>
<div class="cn">地址：浙江省宁波市鄞州区天安大厦1205室</div>`,
    expect: { company_name_cn: '宁波海洋进出口有限公司', contact_name: '李涛', phone_1: '+8613957441234', wechat: 'tonyli_nb', city: 'Ningbo', province: 'Zhejiang' },
  },
  {
    id: 'c3', side: 'front', style: 'light song',
    html: `
<div class="cn big">佛山市顺德区美家家具有限公司</div>
<div class="cn huge">陈小明</div>
<div class="cn">总经理</div>
<div class="cn">手机：139 2233 4455</div>
<div class="cn">电话：0757-2233 4455</div>
<div class="cn">邮箱：chen@meijia-furniture.cn</div>
<div class="cn">地址：广东省佛山市顺德区乐从镇家具城B座12号</div>`,
    expect: {
      company_name_cn: '佛山市顺德区美家家具有限公司', contact_name: '陈小明', job_title: '总经理', phone_1: '+8613922334455', phone_2: '+8675722334455',
      email: 'chen@meijia-furniture.cn', city: 'Foshan', province: 'Guangdong',
    },
  },
  {
    id: 'c4', side: 'front', style: 'dark',
    html: `
<div class="en big">SHENZHEN TOPWAY ELECTRONICS CO.,LTD</div>
<div class="cn">深圳市拓威电子有限公司</div>
<div class="en">Amy Zhang</div>
<div class="sm">Sales Director</div>
<div class="sm">T: 0755-2345 6789 &nbsp; M: 18688889999</div>
<div class="sm">E: amy@topway-sz.com &nbsp; W: topway-sz.com</div>
<div class="sm">WhatsApp: +86 186 8888 9999</div>`,
    expect: {
      company_name: 'SHENZHEN TOPWAY ELECTRONICS CO.,LTD', company_name_cn: '深圳市拓威电子有限公司', contact_name: 'Amy Zhang', job_title: 'Sales Director',
      phone_1: '+8618688889999', email: 'amy@topway-sz.com', website: 'topway-sz.com', whatsapp: '+8618688889999',
    },
  },
  {
    id: 'c4', side: 'back', style: 'light',
    html: `
<div class="en big">Main Products: Power Banks, USB Chargers, Bluetooth Speakers</div>
<div class="en">Booth No.: 9.2 D18-19</div>
<div class="en">Add: 3F, Building A, Hi-Tech Park, Nanshan District, Shenzhen, Guangdong, China</div>`,
    expect: { main_products: 'Power Banks; USB Chargers; Bluetooth Speakers', hall: '9.2', booth: 'D18-19', city: 'Shenzhen', province: 'Guangdong' },
  },
  {
    id: 'c5', side: 'front', style: 'light dense',
    html: `
<div class="qr"></div>
<div class="cn">义乌市星辰日用品有限公司</div>
<div class="en">YIWU XINGCHEN DAILY PRODUCTS CO., LTD</div>
<div class="en">Lily Chen 陈丽丽</div>
<div class="sm">WeChat: lilychen_yw88</div>
<div class="sm">WhatsApp: +86 15867891234</div>
<div class="sm">Email: lily@xcdaily.com</div>
<div class="sm">Booth: 13.1 G22</div>
<div class="sm">Address: No.288 Chouzhou North Road, Yiwu, Zhejiang, China</div>`,
    expect: {
      company_name: 'YIWU XINGCHEN DAILY PRODUCTS CO., LTD', company_name_cn: '义乌市星辰日用品有限公司', wechat: 'lilychen_yw88', whatsapp: '+8615867891234',
      email: 'lily@xcdaily.com', hall: '13.1', booth: 'G22', city: 'Yiwu', province: 'Zhejiang',
    },
  },
  {
    id: 'c6', side: 'front', style: 'light minimal',
    html: `
<div class="en huge">Kevin Huang</div>
<div class="cn">黄凯文 · 采购总监</div>
<div class="en">HUIZHOU GREENLEAF PACKAGING CO., LTD.</div>
<div class="sm">Mobile: +86 137 1234 5678</div>
<div class="sm">kevin.huang@greenleafpack.com</div>
<div class="sm">www.greenleafpack.com</div>`,
    expect: {
      company_name: 'HUIZHOU GREENLEAF PACKAGING CO., LTD.', contact_name: ['Kevin Huang', '黄凯文'], phone_1: '+8613712345678',
      email: 'kevin.huang@greenleafpack.com', website: 'www.greenleafpack.com',
    },
  },
];
