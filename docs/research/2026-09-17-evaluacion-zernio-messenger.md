# Evaluación de Zernio para Messenger

Fecha: 2026-09-17

## Hechos verificados

- El servicio encontrado parece ser **Zernio** (con `n`), no “Zermio”. Su documentación de Facebook indica que una cuenta conectada sirve para publicaciones, analíticas, DMs de Messenger, comentarios y reseñas. El OAuth solicita, entre otros, `pages_messaging` y `pages_manage_metadata`.
  - https://docs.zernio.com/platforms/facebook
  - https://docs.zernio.com/guides/connecting-accounts
- Zernio expone webhooks `message.received`, firma HMAC-SHA256 (`X-Zernio-Signature`), entrega al menos una vez y recomienda deduplicar por el `id` del evento. Declara hasta siete intentos de entrega.
  - https://docs.zernio.com/webhooks
  - https://docs.zernio.com/webhooks/inbox
- Zernio también ofrece listar conversaciones, leer mensajes y enviar mensajes desde una conversación. Las reglas de Meta siguen aplicando, incluida la ventana de 24 horas y las etiquetas permitidas fuera de ella.
  - https://docs.zernio.com/messages/list-inbox-conversations
  - https://docs.zernio.com/messages/send-inbox-message
- La política de privacidad declara que almacena tokens de acceso y datos básicos de las cuentas sociales conectadas. Su Trust Center declara SOC 2 Type II y GDPR, pero parte de la documentación de cumplimiento requiere solicitar acceso.
  - https://zernio.com/privacy-policy
  - https://trust.zernio.com
- La empresa se presenta como un equipo bootstrapped de ocho personas, fundado en 2025. Es información declarada por la propia empresa, no una auditoría independiente.
  - https://zernio.com/about
- Meta distingue entre acceso estándar para roles de la app y Advanced Access para clientes/personas fuera de roles; este último requiere App Review.
  - https://developers.facebook.com/docs/messenger-platform/getting-started/app-setup
  - https://developers.facebook.com/docs/messenger-platform/app-review/

## Inferencia y recomendación

Zernio puede resolver el bloqueo práctico porque tu CRM se conectaría al OAuth de Zernio y recibiría sus webhooks; tu propia app de Meta ya no sería la que necesita estar publicada. No elimina las reglas de Meta: Zernio depende de sus permisos, de que la Página esté administrada correctamente y de que su propia integración siga aprobada y operativa.

Para este proyecto, la opción razonable es usarlo como puente/piloto: probar un mensaje enviado por una cuenta de Facebook que no tenga rol en tu app y confirmar que llega al CRM. Mantener la base de datos del CRM como fuente de verdad y aislar Zernio detrás de un adaptador facilita volver a Meta directo cuando la revisión termine.

Riesgos materiales: dependencia de un proveedor joven, almacenamiento de mensajes/tokens fuera del CRM, cambios o desconexiones de Meta, y portabilidad incompleta si luego se abandona Zernio. Antes de producción hay que comprobar exportación de conversaciones, revocación, SLA real, soporte y qué ocurre con el historial al desconectar.
