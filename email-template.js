const TIMEZONE = 'America/Guayaquil'

const timeFormat = new Intl.DateTimeFormat('es-EC', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderInviteEmail({ key, expiresAt }) {
  const time = timeFormat.format(new Date(expiresAt))
  const subject = 'Tu llave temporal para conectarte a la VPN'
  const lines = {
    greeting: 'Hola,',
    intro: 'Esta es tu llave temporal para conectar un dispositivo a la VPN:',
    expires: `Expira a las ${time} (hora de Ecuador).`,
    oneUse: 'Sirve para un solo dispositivo y un solo uso.',
    steps: 'Pégala en el paso "2. Pega la llave recibida aquí" del portal para generar tu comando de conexión.',
    ignore: 'Si no solicitaste esta llave, ignora este correo.',
  }

  const text = [
    lines.greeting,
    '',
    lines.intro,
    '',
    key,
    '',
    lines.expires,
    lines.oneUse,
    lines.steps,
    '',
    lines.ignore,
  ].join('\n')

  const p = 'margin:0 0 16px;font-size:15px;line-height:1.5;color:#374151;'
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:32px;">
<p style="${p}">${escapeHtml(lines.greeting)}</p>
<p style="${p}">${escapeHtml(lines.intro)}</p>
<p style="margin:0 0 16px;padding:16px;background:#111827;color:#f9fafb;border-radius:6px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:18px;word-break:break-all;user-select:all;">${escapeHtml(key)}</p>
<p style="${p}"><strong>${escapeHtml(lines.expires)}</strong><br>${escapeHtml(lines.oneUse)}</p>
<p style="${p}">${escapeHtml(lines.steps)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(lines.ignore)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, html, text }
}
