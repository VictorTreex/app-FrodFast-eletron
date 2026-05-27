import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const ALLOWED_ORIGINS = [
  'https://treexonline.online',
  'https://www.treexonline.online',
  'http://localhost:8080',
  'http://localhost:5173',
]

function getCorsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

const API_URL =
  'https://kfujkvihymclesabqmsz.supabase.co/functions/v1/api-gateway'

const API_KEY = Deno.env.get('TREEXPAY_SECRET_KEY')

// Rate limiting simples por IP
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

const RATE_LIMIT = 60 // 60 requisições por minuto
const WINDOW_MS = 60 * 1000 // 1 minuto

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  // Rate limiting
  const clientIP = req.headers.get('x-forwarded-for') ||
                   req.headers.get('x-real-ip') ||
                   'unknown'

  const now = Date.now()
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS

  if (!rateLimitMap.has(clientIP)) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: windowStart + WINDOW_MS })
  } else {
    const record = rateLimitMap.get(clientIP)!

    if (now > record.resetTime) {
      record.count = 1
      record.resetTime = windowStart + WINDOW_MS
    } else {
      record.count++
    }

    if (record.count > RATE_LIMIT) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((record.resetTime - now) / 1000)
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil((record.resetTime - now) / 1000).toString()
          },
        }
      )
    }
  }

  try {

    const url = new URL(req.url)

    const path =
      url.pathname.split('/treexpay-proxy')[1] || ''

    // Se path for vazio, não adiciona fallback /payments
    const targetUrl = path ? `${API_URL}${path}` : API_URL

    let body = null

    if (req.method !== 'GET') {
      body = await req.text()

      // Sanitização básica
      if (body.length > 100000) { // 100KB limit
        return new Response(
          JSON.stringify({
            error: 'Payload too large'
          }),
          {
            status: 413,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          }
        )
      }

      // Validar amount
      if (path === '/payments' && req.method === 'POST') {
        try {
          const parsedBody = JSON.parse(body);
          const amount = parsedBody?.amount;

          if (!amount || typeof amount !== 'number' || amount < 100 || amount > 999999) {
            return new Response(
              JSON.stringify({
                error: 'Invalid amount. Must be between 1.00 and 9999.99'
              }),
              {
                status: 400,
                headers: {
                  ...corsHeaders,
                  'Content-Type': 'application/json',
                },
              }
            )
          }
        } catch (parseError) {
          return new Response(
            JSON.stringify({
              error: 'Invalid JSON'
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json',
              },
            }
          )
        }
      }
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY!,
      },
      body,
    })

    const data = await response.text()

    return new Response(data, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })

  } catch (error: any) {

    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
})
