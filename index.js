const crypto = require('crypto')
const express = require('express')
const app = express()
app.use(express.json())

const KWAI_EVENTS_API = 'https://adsnebula.com/log/common/api'
const PORT = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'kwai-proxy' })
})

// Rota de diagnóstico — testa conexão com o Kwai
app.get('/diagnostico', async (req, res) => {
  const KWAI_PIXEL_ID = process.env.KWAI_PIXEL_ID
  const KWAI_TOKEN    = process.env.KWAI_ACCESS_TOKEN

  const payload = {
    pixel_id:     KWAI_PIXEL_ID,
    access_token: KWAI_TOKEN,
    data: [{
      event:      'ViewContent',
      event_time: Math.floor(Date.now() / 1000),
      event_id:   crypto.randomUUID(),
      properties: { value: 0, currency: 'BRL', quantity: 1 },
    }],
  }

  try {
    const r = await fetch(KWAI_EVENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await r.text()
    res.json({ ok: r.ok, status: r.status, body, env: {
      pixel: KWAI_PIXEL_ID ? '✅ definido' : '❌ ausente',
      token: KWAI_TOKEN    ? '✅ definido' : '❌ ausente',
    }})
  } catch (err) {
    res.json({ ok: false, erro: err.message, causa: err.cause?.message, codigo: err.cause?.code })
  }
})

app.post('/kwai-event', async (req, res) => {
  try {
    const { pixel_id, access_token, event_name, value, currency, content_id, content_name, quantity, clickid, test_flag } = req.body

    const KWAI_PIXEL_ID = pixel_id || process.env.KWAI_PIXEL_ID
    const KWAI_TOKEN    = access_token || process.env.KWAI_ACCESS_TOKEN

    if (!KWAI_PIXEL_ID || !KWAI_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Config missing' })
    }

    const event_time = Math.floor(Date.now() / 1000)
    const event_id   = crypto.randomUUID()

    const payload = {
      pixel_id: KWAI_PIXEL_ID,
      access_token: KWAI_TOKEN,
      data: [{
        event: event_name,
        event_time,
        event_id,
        ...(clickid ? { click_id: clickid } : {}),
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

    if (test_flag === true) payload.data[0].test_event_code = 'true'

    const kwaiRes = await fetch(KWAI_EVENTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify(payload),
    })

    const kwaiBody = await kwaiRes.text()
    console.log(`[kwai-proxy] ${event_name} → HTTP ${kwaiRes.status}`, kwaiBody)
    return res.json({ ok: kwaiRes.ok, status: kwaiRes.status, body: kwaiBody })
  } catch (err) {
    console.error('[kwai-proxy] Erro:', err)
    return res.status(500).json({ ok: false, error: err.message, cause: err.cause?.code })
  }
})

app.listen(PORT, () => console.log(`[kwai-proxy] Rodando na porta ${PORT}`))