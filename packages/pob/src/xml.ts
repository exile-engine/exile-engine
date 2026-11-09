/** Deliberately small XML data reader. It performs no entity or remote resolution. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  text: string;
}

export interface PobXmlLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxAttributes: number;
  readonly maxTextLength: number;
}

export const pobXmlLimits: PobXmlLimits = Object.freeze({
  maxBytes: 262_144,
  maxDepth: 16,
  maxNodes: 1024,
  maxAttributes: 32,
  maxTextLength: 131_072,
});

export class XmlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new XmlError('pob.xml-malformed', message);
}

function validCharacter(point: number): boolean {
  return (
    point === 9 ||
    point === 10 ||
    point === 13 ||
    (point >= 0x20 && point <= 0xd7ff) ||
    (point >= 0xe000 && point <= 0xfffd) ||
    (point >= 0x10000 && point <= 0x10ffff)
  );
}

function decode(text: string): string {
  return text.replace(/&([^;]*);|&/g, (raw: string, entity: string | undefined) => {
    const predefined: Readonly<Record<string, string>> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    if (entity !== undefined && Object.hasOwn(predefined, entity)) return predefined[entity]!;
    if (entity !== undefined && /^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) {
      const point =
        entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (validCharacter(point)) return String.fromCodePoint(point);
    }
    return fail(`Unknown or invalid XML entity ${raw}.`);
  });
}

export function parseXml(xml: string, requested: Partial<PobXmlLimits> = {}): XmlElement {
  const limits = { ...pobXmlLimits };
  for (const key of Object.keys(requested)) {
    if (!Object.hasOwn(limits, key)) throw new XmlError('pob.xml-limit', 'Unknown XML limit.');
    const name = key as keyof PobXmlLimits;
    const value = requested[name];
    if (!Number.isSafeInteger(value) || value! < 1 || value! > limits[name])
      throw new XmlError(
        'pob.xml-limit',
        `XML limit ${name} must be positive and at most ${limits[name]}.`,
      );
    limits[name] = value!;
  }
  if (xml.length > limits.maxBytes) throw new XmlError('pob.xml-limit', 'XML byte limit exceeded.');
  let bytes = 0;
  for (const character of xml) {
    const point = character.codePointAt(0)!;
    if (!validCharacter(point)) fail('Invalid XML character.');
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > limits.maxBytes) throw new XmlError('pob.xml-limit', 'XML byte limit exceeded.');
  }
  xml = xml.replace(/\r\n?/g, '\n');
  let index = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  let root: XmlElement | undefined;
  let nodes = 0;
  let textLength = 0;
  const stack: XmlElement[] = [];
  const whitespace = () => {
    while (index < xml.length && /[\t\n\r ]/.test(xml[index]!)) index++;
  };
  const name = () => {
    const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(xml.slice(index));
    if (!match) fail('Expected an XML name.');
    index += match[0].length;
    return match[0];
  };
  if (xml.startsWith('<?xml ', index)) {
    const end = xml.indexOf('?>', index);
    if (
      end < 0 ||
      !/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>$/i.test(
        xml.slice(index, end + 2),
      )
    )
      fail('Unsupported XML declaration.');
    index = end + 2;
  }
  while (index < xml.length) {
    if (xml[index] !== '<') {
      let end = xml.indexOf('<', index);
      if (end < 0) end = xml.length;
      const raw = xml.slice(index, end);
      if (raw.includes(']]>')) fail('CDATA terminator in ordinary text.');
      const value = decode(raw);
      textLength += value.length;
      if (textLength > limits.maxTextLength)
        throw new XmlError('pob.xml-limit', 'XML text limit exceeded.');
      if (stack.length) stack[stack.length - 1]!.text += value;
      else if (value.trim()) fail('Text outside the document element.');
      index = end;
      continue;
    }
    if (xml.startsWith('<!--', index)) {
      const end = xml.indexOf('-->', index + 4);
      if (
        end < 0 ||
        xml.slice(index + 4, end).includes('--') ||
        xml.slice(index + 4, end).endsWith('-')
      )
        fail('Invalid XML comment.');
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', index)) {
      if (!stack.length) fail('CDATA outside the document element.');
      const end = xml.indexOf(']]>', index + 9);
      if (end < 0) fail('Unterminated CDATA.');
      const value = xml.slice(index + 9, end);
      textLength += value.length;
      if (textLength > limits.maxTextLength)
        throw new XmlError('pob.xml-limit', 'XML text limit exceeded.');
      stack[stack.length - 1]!.text += value;
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<!', index) || xml.startsWith('<?', index))
      throw new XmlError(
        'pob.xml-forbidden',
        'DTD, declarations and processing instructions are forbidden.',
      );
    if (xml.startsWith('</', index)) {
      index += 2;
      const closing = name();
      whitespace();
      if (xml[index++] !== '>' || stack.pop()?.name !== closing)
        fail('Mismatched XML closing element.');
      continue;
    }
    index++;
    const elementName = name();
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
    let attributeCount = 0;
    while (true) {
      const before = index;
      whitespace();
      if (xml[index] === '/' || xml[index] === '>') break;
      if (before === index) fail('XML attributes must be separated by whitespace.');
      const attributeName = name();
      if (Object.hasOwn(attributes, attributeName)) fail('Duplicate XML attribute.');
      if (++attributeCount > limits.maxAttributes)
        throw new XmlError('pob.xml-limit', 'XML attribute count exceeded.');
      whitespace();
      if (xml[index++] !== '=') fail('Expected XML attribute assignment.');
      whitespace();
      const quote = xml[index++];
      if (quote !== '"' && quote !== "'") fail('XML attributes must be quoted.');
      const end = xml.indexOf(quote, index);
      if (end < 0 || xml.slice(index, end).includes('<')) fail('Invalid XML attribute value.');
      const value = decode(xml.slice(index, end));
      textLength += value.length;
      if (textLength > limits.maxTextLength)
        throw new XmlError('pob.xml-limit', 'XML text limit exceeded.');
      attributes[attributeName] = value;
      index = end + 1;
    }
    const closed = xml[index] === '/';
    if (closed) index++;
    if (xml[index++] !== '>') fail('Expected XML element terminator.');
    if (++nodes > limits.maxNodes || stack.length + 1 > limits.maxDepth)
      throw new XmlError('pob.xml-limit', 'XML node or depth limit exceeded.');
    const element: XmlElement = { name: elementName, attributes, children: [], text: '' };
    if (stack.length) stack[stack.length - 1]!.children.push(element);
    else if (root) fail('Multiple document elements.');
    else root = element;
    if (!closed) stack.push(element);
  }
  if (!root || stack.length) fail('Missing or unclosed document element.');
  return root;
}
