export interface Question {
  id: string;
  label: string;
  type:
    | 'text'
    | 'textarea'
    | 'radio'
    | 'checkbox'
    | 'select'
    | 'number'
    | 'range'
    | 'color'
    | 'switch'
    | 'direction-cards'; // 特殊类型：渲染5视觉方向卡片
  options?: string[] | { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
  defaultValue?: any;
  min?: number;
  max?: number;
}

export interface QuestionFormBlock {
  id: string;
  type?: string;
  questions: Question[];
}

export interface TextSegment {
  type: 'text';
  text: string;
}

export interface FormSegment {
  type: 'form';
  form: QuestionFormBlock;
}

export type Segment = TextSegment | FormSegment;

/**
 * 查找并提取文本中的第一个 `<question-form>`
 */
export function findFirstQuestionForm(input: string): QuestionFormBlock | null {
  const regex = /<(question-form|ask-question)([^>]*)>([\s\S]*?)</\1>/i;
  const match = input.match(regex);
  if (!match) return null;

  try {
    const jsonText = match[3].trim();
    const parsed = JSON.parse(jsonText);
    const idAttr = match[2].match(/id="([^"]+)"/);
    const id = idAttr ? idAttr[1] : (parsed.id || 'discovery');
    const typeAttr = match[2].match(/type="([^"]+)"/);
    const type = typeAttr ? typeAttr[1] : parsed.type;

    return {
      id,
      type,
      questions: parsed.questions || [],
    };
  } catch (e) {
    console.error('Failed to parse question-form JSON', e);
    return null;
  }
}

/**
 * 将混杂了 `<question-form>` 的文本切分为文本段和表单段
 */
export function splitOnQuestionForms(input: string): Segment[] {
  const regex = /<(question-form|ask-question)([^>]*)>([\s\S]*?)</\1>/gi;
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    // 文本段
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        text: input.slice(lastIndex, match.index),
      });
    }

    // 表单段
    try {
      const jsonText = match[3].trim();
      const parsed = JSON.parse(jsonText);
      const idAttr = match[2].match(/id="([^"]+)"/);
      const id = idAttr ? idAttr[1] : (parsed.id || 'discovery');
      const typeAttr = match[2].match(/type="([^"]+)"/);
      const type = typeAttr ? typeAttr[1] : parsed.type;

      segments.push({
        type: 'form',
        form: {
          id,
          type,
          questions: parsed.questions || [],
        },
      });
    } catch {
      // 容错：如果 JSON 解析失败，当成普通文本
      segments.push({
        type: 'text',
        text: match[0],
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      type: 'text',
      text: input.slice(lastIndex),
    });
  }

  return segments;
}
