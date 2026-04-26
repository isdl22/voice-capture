const Anthropic = require('@anthropic-ai/sdk');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { transcript } = req.body;
  if (!transcript || transcript.trim().length < 5) {
    return res.json({ summary: '통화 내용이 너무 짧습니다.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY 환경변수를 설정해주세요.' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `다음은 전화 통화 내용입니다. 핵심 내용만 간결하게 요약해주세요.
날짜/시간, 장소, 해야 할 일, 주요 결정사항이 있으면 포함하세요. 없는 항목은 생략하세요.

통화 내용:
${transcript}

요약 형식: 각 항목 앞에 관련 이모지를 붙이고, 항목당 한 줄로 작성.`,
      }],
    });
    res.json({ summary: message.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
