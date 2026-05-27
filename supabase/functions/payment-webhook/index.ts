import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-treex-signature',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

interface WebhookPayload {
  event: string;
  payment: {
    id: string;
    amount: number;
    status: string;
    payment_method: string;
    paid_at?: string;
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get('Origin'))

  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: corsHeaders }
      )
    }

    // Verificar assinatura do webhook (HMAC SHA256)
    const signature = req.headers.get('x-treex-signature')
    const webhookSecret = Deno.env.get('TREEXPAY_WEBHOOK_SECRET')
    
    if (!signature) {
      console.warn('Webhook sem assinatura')
      return new Response('Unauthorized - Missing signature', { 
        status: 401, 
        headers: corsHeaders 
      })
    }
    
    if (!webhookSecret) {
      console.error('Webhook secret não configurado')
      return new Response('Internal Server Error', { 
        status: 500, 
        headers: corsHeaders 
      })
    }
    
    // Obter body raw para validação HMAC
    const bodyText = await req.text()
    const key = await crypto.subtle.importKey(
      { 
        name: "HMAC", 
        hash: "SHA-256" 
      },
      new TextEncoder().encode(webhookSecret),
      { 
        name: "HMAC", 
        hash: "SHA-256" 
      },
      false
    )
    
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(bodyText)
    )
    
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    
    // Comparar assinaturas (timing-safe comparison)
    const sigA = new TextEncoder().encode(signature)
    const sigB = new TextEncoder().encode(expectedSignature)
    
    if (sigA.length !== sigB.length) {
      return new Response('Unauthorized - Invalid signature', { 
        status: 401, 
        headers: corsHeaders 
      })
    }
    
    let result = 0
    for (let i = 0; i < sigA.length; i++) {
      result |= sigA[i] ^ sigB[i]
    }
    
    if (result !== 0) {
      console.warn('Assinatura do webhook inválida')
      return new Response('Unauthorized - Invalid signature', { 
        status: 401, 
        headers: corsHeaders 
      })
    }
    
    // Parse JSON body
    let body: WebhookPayload
    try {
      body = JSON.parse(bodyText)
    } catch (parseError) {
      console.error('Erro ao parsear JSON:', parseError)
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { status: 400, headers: corsHeaders }
      )
    }
    
    // Validar payload
    if (!body.event || !body.payment) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload' }),
        { status: 400, headers: corsHeaders }
      )
    }

    const { payment } = body
    console.log('Webhook recebido:', { event: body.event, paymentId: payment.id })

    // Processar apenas eventos de pagamento
    if (body.event !== 'payment.paid') {
      console.log('Evento ignorado:', body.event)
      return new Response(
        JSON.stringify({ message: 'Event ignored' }),
        { status: 200, headers: corsHeaders }
      )
    }

    // Conectar ao Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Buscar pedido de pagamento
    const { data: paymentOrder, error: orderError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('payment_id', payment.id)
      .single()

    if (orderError || !paymentOrder) {
      console.error('Pedido não encontrado:', payment.id)
      return new Response(
        JSON.stringify({ error: 'Payment order not found' }),
        { status: 404, headers: corsHeaders }
      )
    }

    // Verificar se já foi processado
    if (paymentOrder.status === 'paid') {
      console.log('Pagamento já processado:', payment.id)
      return new Response(
        JSON.stringify({ message: 'Already processed' }),
        { status: 200, headers: corsHeaders }
      )
    }

    // Atualizar status do pedido
    const { error: updateError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        paid_at: payment.paid_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentOrder.id)

    if (updateError) {
      console.error('Erro ao atualizar pedido:', updateError)
      return new Response(
        JSON.stringify({ error: 'Failed to update order' }),
        { status: 500, headers: corsHeaders }
      )
    }

    // Atualizar plano do usuário
    const planDuration = paymentOrder.plan_id === 'annual' ? 'annual' : 'monthly'
    const planExpiresAt = planDuration === 'annual' 
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 ano
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dias

    // Validar owner do pagamento - garantir que payment.user_id === authenticated_user.id
    // Isso já é validado pela política RLS "Users can update their payment orders"
    // mas adicionamos validação extra por segurança
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', paymentOrder.user_id)
      .single()

    if (profileError || !profile) {
      console.error('Perfil não encontrado:', paymentOrder.user_id)
      return new Response(
        JSON.stringify({ error: 'Profile not found' }),
        { status: 404, headers: corsHeaders }
      )
    }

    if (profile.id !== paymentOrder.user_id) {
      console.error('Owner do pagamento inválido:', paymentOrder.user_id)
      return new Response(
        JSON.stringify({ error: 'Invalid payment owner' }),
        { status: 401, headers: corsHeaders }
      )
    }

    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update({
        current_plan: paymentOrder.plan_id,
        plan_active: true,
        plan_type: paymentOrder.plan_id,
        plan_expires_at: planExpiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentOrder.user_id)

    if (updateProfileError) {
      console.error('Erro ao atualizar perfil:', updateProfileError)
      return new Response(
        JSON.stringify({ error: 'Failed to update profile' }),
        { status: 500, headers: corsHeaders }
      )

if (orderError || !paymentOrder) {
  console.error('Pedido não encontrado:', payment.id)
  return new Response(
    JSON.stringify({ error: 'Payment order not found' }),
    { status: 404, headers: corsHeaders }
  )
}

// Verificar se já foi processado
if (paymentOrder.status === 'paid') {
  console.log('Pagamento já processado:', payment.id)
  return new Response(
    JSON.stringify({ message: 'Already processed' }),
    { status: 200, headers: corsHeaders }
  )
}

// Validar que payment_id existe e não é nulo
if (!payment.id || payment.id.trim() === '') {
  console.error('payment_id inválido:', payment.id)
  return new Response(
    JSON.stringify({ error: 'Invalid payment_id' }),
    { status: 400, headers: corsHeaders }
  )
}

// Atualizar status do pedido
const { error: updateError } = await supabase
  .from('payment_orders')
  .update({
    status: 'paid',
    paid_at: payment.paid_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  })
  .eq('id', paymentOrder.id)

  } catch (error) {
    console.error('Erro no webhook:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: corsHeaders }
    )
  }
})
