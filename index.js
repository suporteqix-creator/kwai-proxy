const crypto = require('crypto')
const express = require('express')
const app = express()
app.use(express.json())

const PORT = process.env.PORT || 3000

// Endpoints para testar
const ENDPOINT_NOVO   = 'https://e.kwai.com/uac/adxe/event'        // Asia (pode falhar)
const ENDPOINT_GLOBAL = 'https://api.kwai.com/rest/o/v1/kwaipix/event' // Global
const ENDPOINT_OLD    = 'https://adsnebula.com/log/common/api'       // Antigo

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'kwai-proxy' })
})

// Diagnóstico — testa múltiplos formatos no endpoint global
app.get('/diagnostico', async (req, res) => {
  const KWAI_PIXEL_ID = process.env.KWAI_PIXEL_ID
  const KWAI_TOKEN    = process.env.KWAI_ACCESS_TOKEN
  const results = []

  // Formato 1: novo (pixel_id + access_token no body)
  try {
    const r = await fetch(ENDPOINT_GLOBAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        pixel_id: KWAI_PIXEL_ID,
        access_token: KWAI_TOKEN,
        data: [{ event: 'ViewContent', event_time: Math.floor(Date.now() / 1000), event_id: crypto.randomUUID(), properties: { value: 0, currency: 'BRL', quantity: 1 } }],
      }),
    })
    results.push({ formato: 'novo_global', status: r.status, body: (await r.text()).slice(0, 300) })
  } catch(e) { results.push({ formato: 'novo_global', erro: e.message }) }

  // Formato 2: SDK antigo (adsnebula) com pixelSdkVersion + trackFlag
  try {
    const r = await fetch(ENDPOINT_OLD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({
        access_token: KWAI_TOKEN,
        pixelId: KWAI_PIXEL_ID,
        pixelSdkVersion: '9.9.9',
        event_name: 'ViewContent',
        trackFlag: true,
        properties: JSON.stringify({ value: 0, currency: 'BRL', quantity: 1 }),
      }),
    })
    results.push({ formato: 'antigo_adsnebula', status: r.status, body: (await r.text()).slice(0, 300) })
  } catch(e) { results.push({ formato: 'antigo_adsnebula', erro: e.message }) }

  // Formato 3: token no header Authorization
  try {
    const r = await fetch(ENDPOINT_GLOBAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KWAI_TOKEN}` },
      body: JSON.stringify({
        pixel_id: KWAI_PIXEL_ID,
        data: [{ event: 'ViewContent', event_time: Math.floor(Date.now() / 1000), event_id: crypto.randomUUID(), properties: { value: 0, currency: 'BRL', quantity: 1 } }],
      }),
    })
    results.push({ formato: 'bearer_header', status: r.status, body: (await r.text()).slice(0, 300) })
  } catch(e) { results.push({ formato: 'bearer_header', erro: e.message }) }

  res.json({ env: { pixel: KWAI_PIXEL_ID ? '✅' : '❌', token: KWAI_TOKEN ? '✅' : '❌' }, results })
})

// Rota principal — usa o formato que funcionou
app.post('/kwai-event', async (req, res) => {
  try {
    const { event_name, value, currency, content_id, content_name, quantity, clickid, test_flag } = req.body
    const KWAI_PIXEL_ID = process.env.KWAI_PIXEL_ID
    const KWAI_TOKEN    = process.env.KWAI_ACCESS_TOKEN

    if (!KWAI_PIXEL_ID || !KWAI_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Config missing' })
    }

    const event_time = Math.floor(Date.now() / 1000)
    const event_id   = crypto.randomUUID()

    const payload = {
      pixel_id:     KWAI_PIXEL_ID,
      access_token: KWAI_TOKEN,
      data: [{
        event: event_name,
        event_time,
        event_id,
        ...(clickid ? { click_id: clickid } : {}),
        ...(test_flag ? { test_event_code: 'true' } : {}),
        properties: {
          content_id:   content_id   ?? 'rifa-tiguan',
          content_type: 'product',
          content_name: content_name ?? 'Bilhete Rifa',
          value,
          currency: currency ?? 'BRL',
          quantity,
        },
      }],
    }

    // Tenta endpoint global primeiro, fallback para antigo
    let kwaiRes, kwaiBody
    try {
      kwaiRes  = await fetch(ENDPOINT_GLOBAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(payload),
      })
      kwaiBody = await kwaiRes.text()
      // Se retornar HTML (502), tenta o antigo
      if (kwaiBody.includes('<!DOCTYPE')) throw new Error('HTML response, trying fallback')
    } catch {
      // Fallback: formato SDK antigo
      kwaiRes  = await fetch(ENDPOINT_OLD, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: KWAI_TOKEN,
          pixelId: KWAI_PIXEL_ID,
          pixelSdkVersion: '9.9.9',
          event_name,
          trackFlag: !!test_flag,
          ...(clickid ? { clickid } : {}),
          properties: JSON.stringify({ value, currency: currency ?? 'BRL', quantity }),
        }),
      })
      kwaiBody = await kwaiRes.text()
    }

    console.log(`[kwai-proxy] ${event_name} → HTTP ${kwaiRes.status}`, kwaiBody)
    return res.json({ ok: kwaiRes.ok, status: kwaiRes.status, body: kwaiBody })
  } catch (err) {
    console.error('[kwai-proxy] Erro:', err)
    return res.status(500).json({ ok: false, error: err.message, cause: err.cause?.code })
  }
})

app.listen(PORT, () => console.log(`[kwai-proxy] Rodando na porta ${PORT}`))