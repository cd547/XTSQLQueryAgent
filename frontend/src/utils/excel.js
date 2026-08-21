import { message } from 'antd';

/**
 * 字符宽度计算：中文按 2 个宽度，英文/数字按 1 个。
 * 用于 Excel 导出时根据字符串实际显示宽度估算列宽。
 *
 * @param {*} str
 * @returns {number}
 */
export function getCharWidth(str) {
  if (str == null) return 0;
  const s = String(str);
  let w = 0;
  for (const ch of s) {
    w += /[一-鿿　-〿＀-￯]/.test(ch) ? 2 : 1;
  }
  return w;
}

/**
 * 导出 antd Table 数据为带样式的 xlsx 文件。
 *
 * 特性：
 *  - 使用 xlsx-js-style（社区 fork）支持写入单元格样式；原 xlsx 社区版会静默丢弃 .s
 *  - 表头：加粗 + 白字 + 蓝色背景 + 居中 + 边框
 *  - 数据：浅色边框 + 垂直居中 + 自动换行
 *  - 自适应列宽（中文按 2 算，最多采样 500 行）
 *  - 冻结首行 + 表头行高 24
 *
 * @param {Array<Object>} data - 行数据数组
 * @param {Array<{dataIndex: string, title?: string}>} cols - 列定义
 * @param {{success: Function, error: Function}} [messageApi] - antd App.useApp() 返回的 message API。
 *   必传：消除 "[antd: message] Static function can not consume context like dynamic theme." 警告。
 *   工具函数本身非 React 组件，无法用 hook，调用方从 useApp() 取得后注入。
 * @returns {Promise<void>}
 */
export async function exportToExcel(data, cols, messageApi) {
  try {
    // 使用 xlsx-js-style（xlsx 的社区分支），支持写入单元格样式；原 xlsx 社区版会静默丢弃 .s
    const XLSX = await import('xlsx-js-style');
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();

    // 1) 自适应列宽：根据每列表头和数据的最大字符宽度计算（中文按 2 算）
    const keys = data.length > 0 ? Object.keys(data[0]) : cols.map(c => c.dataIndex);
    const colMeta = keys.map(key => {
      const col = cols.find(c => c.dataIndex === key);
      const headerText = col ? (typeof col.title === 'string' ? col.title : String(col.dataIndex || key)) : key;
      let maxWidth = getCharWidth(headerText);
      const sampleSize = Math.min(data.length, 500);
      for (let i = 0; i < sampleSize; i++) {
        const w = getCharWidth(data[i]?.[key]);
        if (w > maxWidth) maxWidth = w;
      }
      return { wch: Math.min(60, Math.max(10, maxWidth + 4)) };
    });
    worksheet['!cols'] = colMeta;

    // 2) 表头样式：加粗 + 白字 + 蓝色背景 + 居中 + 边框
    const headerStyle = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12, name: '微软雅黑' },
      fill: { patternType: 'solid', fgColor: { rgb: '4472C4' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: '8EA9DB' } },
        bottom: { style: 'thin', color: { rgb: '8EA9DB' } },
        left: { style: 'thin', color: { rgb: '8EA9DB' } },
        right: { style: 'thin', color: { rgb: '8EA9DB' } },
      },
    };
    // 数据样式：浅色边框 + 垂直居中 + 自动换行
    const dataStyle = {
      font: { sz: 11, name: '微软雅黑' },
      alignment: { vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'D9D9D9' } },
        bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
        left: { style: 'thin', color: { rgb: 'D9D9D9' } },
        right: { style: 'thin', color: { rgb: 'D9D9D9' } },
      },
    };

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const ref = XLSX.utils.encode_cell({ r: R, c: C });
        if (worksheet[ref]) {
          worksheet[ref].s = R === 0 ? headerStyle : dataStyle;
        }
      }
    }

    // 3) 冻结首行（xlsx-js-style 通过 !views 写入）
    worksheet['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activePane: 'bottomLeft' }];
    // 表头行高
    worksheet['!rows'] = [{ hpt: 24 }];

    XLSX.utils.book_append_sheet(workbook, worksheet, '查询结果');
    XLSX.writeFile(workbook, `查询结果_${Date.now()}.xlsx`);
    messageApi?.success('导出成功');
  } catch (e) {
    console.error('导出Excel失败:', e);
    messageApi?.error('导出失败：' + (e?.message || '未知错误'));
  }
}
