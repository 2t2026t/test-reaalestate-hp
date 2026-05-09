/**
 * テスト不動産 HP — API 中継サーバー
 *
 * 役割:
 *   - company.html などの静的ファイルを配信する
 *   - POST /api/chat を受け取り、ANTHROPIC_API_KEY を使って
 *     Claude API を呼び出し、SSE ストリームでクライアントに返す
 *
 * 起動:
 *   node server.js          （本番）
 *   node --watch server.js  （開発：ファイル変更で自動再起動）
 */

'use strict';

require('dotenv').config();              /* .env から環境変数を読み込む */
const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const path       = require('path');

/* ===== 設定 ===== */
const PORT  = process.env.PORT || 3000;
const MODEL = 'claude-opus-4-7';

/* APIキーの確認（未設定の場合は警告のみ・Vercel環境変数で設定） */
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[警告] 環境変数 ANTHROPIC_API_KEY が設定されていません。');
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

/* ===== テスト太郎（個人 HP）のシステムプロンプト ===== */
const PERSONAL_SYSTEM_PROMPT = `あなたはテスト太郎の公式ウェブサイトのアシスタント AI です。
テスト太郎は東京在住の AI エンジニア（Machine Learning Engineer）で、経験年数は5年以上です。

【スキル・技術スタック】
- AI / ML : PyTorch, TensorFlow, Transformers, LangChain, RAG
- バックエンド : Python, FastAPI, Docker, PostgreSQL, Redis
- クラウド / インフラ : AWS, GCP, Kubernetes, Terraform

【対応方針】
- 訪問者の質問に日本語で丁寧かつ簡潔に答えてください。
- 仕事の依頼・お問い合わせは taro@example.com を案内してください。
- テスト太郎が公開していない詳細（具体的な案件・報酬など）は直接連絡を促してください。
- AI・機械学習・ソフトウェア開発に関する技術的な質問には積極的に答えてください。
- 返答は短めにまとめ、必要に応じて箇条書きを使ってください。`;

/* ===== テスト不動産のシステムプロンプト ===== */
const SYSTEM_PROMPT = `あなたは「株式会社テスト不動産」のAIサポートスタッフです。
以下の自社情報をもとに、お客様のご質問に正確かつ丁寧にお答えください。

【サービス名】
株式会社テスト不動産

【サービス内容】
物件の紹介・無料相談

【料金（物件価格）】
- 渋谷区恵比寿：20,000万円

【営業時間・連絡先】
- 営業時間：9:00〜19:00
- 電話番号：0120-123-4567
- メールアドレス：estatejapan@co.jp

【よくある質問と回答】
Q: 内見は立ち合いになりますか？
A: はい。立ち合いになりますのでご希望の物件、日時と時間、お名刺をFAXにてお送りくださいませ。

Q: 物件資料をお送りいただくことは可能でしょうか？
A: はい。後ほど、メールにてご送付いたしますのでメールアドレスを教えていただいてもよろしいでしょうか？また、電話にてお問い合わせをお願いいたします。

【回答方針】
- 丁寧で親しみやすい日本語で回答してください。
- 上記の自社情報に基づいて正確に答えてください。
- 営業時間・電話番号・メールアドレスを案内する場合は、必ず上記の情報を使用してください。
- よくある質問に対しては、上記の回答をそのままお伝えください。
- 上記に記載のない情報については「担当者よりご案内します。お電話（0120-123-4567）またはメール（estatejapan@co.jp）でお気軽にご連絡ください」と案内してください。
- 返答は簡潔にまとめ、適度に絵文字を使って読みやすくしてください。
- 不動産に無関係な話題は穏やかに不動産のお話へ誘導してください。`;

/* ===== Express アプリ設定 ===== */
const app = express();

/* リクエストボディのサイズ制限（最大 1MB） */
app.use(express.json({ limit: '1mb' }));

/* 静的ファイルの配信（index.html・company.html など） */
app.use(express.static(path.join(__dirname)));

/* ===== POST /api/personal-chat（個人 HP 用） ===== */
app.post('/api/personal-chat', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages は空でない配列で指定してください。' });
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  try {
    const stream = await client.messages.create({
      model:      MODEL,
      max_tokens: 1024,
      system:     PERSONAL_SYSTEM_PROMPT,
      messages,
      stream:     true,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[Claude API エラー / personal]', err.message);

    let userMsg = 'AI との通信中にエラーが発生しました。しばらく後に再度お試しください。';
    if (err.status === 401) userMsg = 'APIキーが無効です。';
    if (err.status === 429) userMsg = 'リクエストが多すぎます。しばらく待ってから再送してください。';

    res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
    res.end();
  }
});

/* ===== POST /api/chat ===== */
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  /* バリデーション */
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages は空でない配列で指定してください。' });
  }

  /* SSE レスポンスヘッダー */
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  try {
    /* Claude API をストリーミングで呼び出す */
    const stream = await client.messages.create({
      model:      MODEL,
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages,
      stream:     true,
    });

    /* テキストチャンクが届くたびにクライアントへ転送 */
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta'
      ) {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    /* ストリーム終了を通知 */
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[Claude API エラー]', err.message);

    /* エラー内容をクライアントへ送信してから接続を閉じる */
    let userMsg = 'AIサービスとの通信中にエラーが発生しました。しばらく後に再度お試しください。';
    if (err.status === 401) userMsg = 'APIキーが無効です。サーバーの設定をご確認ください。';
    if (err.status === 429) userMsg = 'リクエストが多すぎます。しばらく待ってから再送してください。';

    res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
    res.end();
  }
});

/* ===== サーバー起動（ローカル開発時のみ） ===== */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ サーバーが起動しました → http://localhost:${PORT}`);
    console.log(`   個人HP      : http://localhost:${PORT}/index.html`);
    console.log(`   会社HP      : http://localhost:${PORT}/company.html`);
  });
}

/* Vercel のサーバーレス環境用にアプリをエクスポート */
module.exports = app;
