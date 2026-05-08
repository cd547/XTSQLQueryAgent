import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 tokenizer.json
const tokenizerPath = path.join(__dirname, '../../deepseek_v3_tokenizer/tokenizer.json');
let vocab = null;
let merges = null;
let mergesMap = null;

try {
  const data = fs.readFileSync(tokenizerPath, 'utf-8');
  const tokenizerData = JSON.parse(data);
  vocab = tokenizerData.model?.vocab || {};
  
  // 加载合并规则并创建映射
  merges = tokenizerData.model?.merges || [];
  mergesMap = new Map();
  merges.forEach((merge, index) => {
    const [first, second] = merge.split(' ');
    if (first && second) {
      mergesMap.set(`${first},${second}`, index);
    }
  });
} catch (e) {
  console.warn('Failed to load tokenizer.json, using fallback token counting');
}

// 简单的回退 token 计数方法
function simpleTokenCount(text) {
  if (!text || typeof text !== 'string') return 0;
  
  let count = 0;
  const tokens = text.split(/\s+/);
  
  for (const token of tokens) {
    if (token.length === 0) continue;
    
    // 匹配单词
    const wordMatches = token.match(/[\p{L}]+/gu);
    if (wordMatches) count += wordMatches.length;
    
    // 匹配数字
    const numMatches = token.match(/[\p{N}]+/gu);
    if (numMatches) count += numMatches.length;
    
    // 匹配标点和特殊字符
    const punctMatches = token.match(/[^\s\p{L}\p{N}]+/gu);
    if (punctMatches) count += punctMatches.length;
  }
  
  return count;
}

// 获取字符对
function getPairs(tokens) {
  const pairs = new Map();
  for (let i = 0; i < tokens.length - 1; i++) {
    const pairKey = `${tokens[i]},${tokens[i + 1]}`;
    pairs.set(pairKey, (pairs.get(pairKey) || 0) + 1);
  }
  return pairs;
}

// BPE 编码实现
function bpeEncode(text) {
  if (!vocab || !mergesMap) {
    return simpleTokenCount(text);
  }

  // 将文本转换为字符数组作为初始 tokens
  let tokens = Array.from(text);
  
  // 对不在 vocab 中的字符进行字节拆分
  const newTokens = [];
  for (const char of tokens) {
    if (vocab[char] !== undefined) {
      newTokens.push(char);
    } else {
      // 字符不在 vocab 中，拆分为 UTF-8 字节
      const utf8 = Buffer.from(char, 'utf8');
      for (const byte of utf8) {
        newTokens.push(String.fromCharCode(byte));
      }
    }
  }
  tokens = newTokens;

  // 应用 BPE 合并（限制最大迭代次数防止无限循环）
  const maxIterations = 10000;
  let iterations = 0;
  
  while (tokens.length > 1 && iterations < maxIterations) {
    const pairs = getPairs(tokens);
    if (pairs.size === 0) break;

    let bestPair = null;
    let bestRank = Infinity;

    for (const [pairKey, count] of pairs) {
      const rank = mergesMap.get(pairKey);
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        bestPair = pairKey.split(',');
      }
    }

    if (bestPair === null) break;

    const [first, second] = bestPair;
    const newToken = first + second;
    
    const mergedTokens = [];
    let i = 0;
    while (i < tokens.length) {
      if (i < tokens.length - 1 && tokens[i] === first && tokens[i + 1] === second) {
        mergedTokens.push(newToken);
        i += 2;
      } else {
        mergedTokens.push(tokens[i]);
        i += 1;
      }
    }
    
    // 如果没有发生任何合并，退出循环
    if (mergedTokens.length === tokens.length) break;
    
    tokens = mergedTokens;
    iterations++;
  }

  return tokens.length;
}

export function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  
  if (vocab && mergesMap) {
    try {
      return bpeEncode(text);
    } catch (e) {
      console.warn('BPE encoding failed, falling back to simple count:', e.message);
      return simpleTokenCount(text);
    }
  }
  
  return simpleTokenCount(text);
}

export function countMessagesTokens(messages) {
  if (!messages || !Array.isArray(messages)) return 0;
  
  let total = 0;
  
  for (const msg of messages) {
    if (msg.content && typeof msg.content === 'string') {
      total += countTokens(msg.content);
    }
  }
  
  return total;
}

export default {
  countTokens,
  countMessagesTokens
};