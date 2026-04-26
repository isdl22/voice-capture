const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { transcript } = req.body;
  if (!transcript || transcript.trim().length < 5) {
    return res.json({ summary: '통화 내용이 너무 짧습니다.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ error: 'GEMINI_API_KEY 환경변수를 설정해주세요.' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent(`다음은 전화 통화 내용입니다. 핵심 내용만 간결하게 요약해주세요.
날짜/시간, 장소, 해야 할 일, 주요 결정사항이 있으면 포함하세요. 없는 항목은 생략하세요.

통화 내용:
${transcript}

요약 형식: 각 항목 앞에 관련 이모지를 붙이고, 항목당 한 줄로 작성.`);

    res.json({ summary: result.response.text() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
