require('dotenv/config')
const cors = require('cors')
const express = require('express')

const app = express()
const port = Number(process.env.PORT || 3000)

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'asistencia-api' })
})

app.listen(port, () => console.log(`API disponible en http://localhost:${port}`))
