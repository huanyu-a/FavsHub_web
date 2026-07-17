/**
 * 提示词模板变量工具
 * 解析 content 中的 {{变量名}} 占位符，提取唯一变量列表
 */

const VAR_PATTERN = /\{\{([^}]+)\}\}/g

/**
 * 从提示词内容中提取所有模板变量名（去重、保序）
 */
export function parseTemplateVariables(content: string): string[] {
  if (!content) return []
  const vars: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  VAR_PATTERN.lastIndex = 0
  while ((match = VAR_PATTERN.exec(content)) !== null) {
    const name = match[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      vars.push(name)
    }
  }
  return vars
}

/**
 * 用用户输入替换模板变量，返回最终文本
 */
export function fillTemplateVariables(content: string, values: Record<string, string>): string {
  return content.replace(VAR_PATTERN, (_full, name: string) => {
    const val = values[name.trim()]
    return val !== undefined ? val : `{{${name}}}`
  })
}
