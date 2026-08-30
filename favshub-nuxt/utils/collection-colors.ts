/**
 * 精选集视觉身份：由 id 确定性地生成一对渐变色，
 * 卡片与详情页共用，同一精选集在任意页面呈现同一色系。
 * 饱和度/明度取中段保证白色前景在明暗主题下都可读。
 */

export interface ICollectionGradient {
  /** 渐变起色 */
  c1: string
  /** 渐变止色 */
  c2: string
  /** 主色相（用于光晕等衍生） */
  hue: number
}

export function collectionGradient(id: string | number | null | undefined): ICollectionGradient {
  const s = String(id ?? '')
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  const hue2 = (hue + 42) % 360
  return {
    c1: `hsl(${hue} 72% 58%)`,
    c2: `hsl(${hue2} 74% 40%)`,
    hue,
  }
}

/** 封面渐变的内联样式字符串 */
export function collectionCoverStyle(id: string | number | null | undefined): Record<string, string> {
  const g = collectionGradient(id)
  return {
    '--cover-c1': g.c1,
    '--cover-c2': g.c2,
    '--cover-hue': String(g.hue),
  }
}
