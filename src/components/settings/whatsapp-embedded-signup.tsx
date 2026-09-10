'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, Loader2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  parseEmbeddedSignupMessage,
  type EmbeddedSignupMessage,
} from './whatsapp-embedded-signup-logic';

const FACEBOOK_SDK_SCRIPT_ID = 'facebook-jssdk';
const FACEBOOK_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';

interface EmbeddedSignupConfig {
  appId: string;
  configId: string;
}

interface WhatsAppEmbeddedSignupProps {
  verifyToken: string;
  onConnected: () => Promise<void>;
}

function loadFacebookSdk(appId: string): Promise<FacebookSDK> {
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: true, version: 'v21.0' });
    return Promise.resolve(window.FB);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const previousInit = window.fbAsyncInit;
    const timers: { pollId?: number; timeoutId?: number } = {};

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timers.pollId !== undefined) window.clearInterval(timers.pollId);
      if (timers.timeoutId !== undefined) window.clearTimeout(timers.timeoutId);
      window.fbAsyncInit = previousInit;
      if (error) reject(error);
      else if (window.FB) resolve(window.FB);
      else reject(new Error('Facebook SDK did not initialize'));
    };

    const initialize = () => {
      if (!window.FB) return;
      try {
        window.FB.init({ appId, cookie: true, xfbml: true, version: 'v21.0' });
        finish();
      } catch {
        finish(new Error('Facebook SDK initialization failed'));
      }
    };

    window.fbAsyncInit = () => {
      try {
        previousInit?.();
      } catch {
        // A previous SDK consumer must not prevent this flow from loading.
      }
      initialize();
    };

    const script = document.getElementById(FACEBOOK_SDK_SCRIPT_ID);
    if (!script) {
      const element = document.createElement('script');
      element.id = FACEBOOK_SDK_SCRIPT_ID;
      element.async = true;
      element.defer = true;
      element.src = FACEBOOK_SDK_URL;
      element.onerror = () => finish(new Error('Facebook SDK failed to load'));
      document.body.appendChild(element);
    }

    // The SDK normally calls fbAsyncInit, while the poll also handles a
    // script tag that was already present before this component mounted.
    timers.pollId = window.setInterval(initialize, 50);
    timers.timeoutId = window.setTimeout(
      () => finish(new Error('Facebook SDK loading timed out')),
      15_000
    );
  });
}

export function WhatsAppEmbeddedSignup({
  verifyToken,
  onConnected,
}: WhatsAppEmbeddedSignupProps) {
  const t = useTranslations('Settings.whatsapp');
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeCleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void fetch('/api/whatsapp/embedded-signup', { method: 'GET' })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          app_id?: unknown;
          config_id?: unknown;
        };
        if (!response.ok) return;
        if (
          typeof body.app_id !== 'string' ||
          typeof body.config_id !== 'string'
        )
          return;
        if (mountedRef.current) {
          setConfig({ appId: body.app_id, configId: body.config_id });
        }
      })
      .catch(() => {
        // Rendering the unavailable state is enough; the manual path remains.
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => {
      mountedRef.current = false;
      activeCleanupRef.current?.();
      activeCleanupRef.current = null;
    };
  }, []);

  async function connect() {
    if (!config || connecting) return;

    setConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const sdk = await loadFacebookSdk(config.appId);
      if (!mountedRef.current) return;

      let code: string | null = null;
      let session: Extract<EmbeddedSignupMessage, { kind: 'finished' }> | null =
        null;
      let submitted = false;
      const cleanup = () => {
        window.removeEventListener('message', handleMessage);
        window.clearTimeout(timeoutId);
        if (activeCleanupRef.current === cleanup)
          activeCleanupRef.current = null;
      };

      const fail = (message: string) => {
        cleanup();
        if (!mountedRef.current) return;
        setConnecting(false);
        setError(message);
      };

      const submitWhenReady = async () => {
        if (submitted || !code || !session) return;
        submitted = true;
        cleanup();

        try {
          const response = await fetch('/api/whatsapp/embedded-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              waba_id: session.wabaId,
              phone_number_id: session.phoneNumberId,
              verify_token: verifyToken.trim() || undefined,
            }),
          });
          const body = (await response.json().catch(() => ({}))) as {
            saved?: boolean;
            registration_error?: string;
          };

          if (!response.ok || !body.saved) {
            throw new Error(
              response.status === 400
                ? t('embeddedMetaRejected')
                : t('embeddedSaveFailed')
            );
          }

          await onConnected();
          if (!mountedRef.current) return;
          setConnecting(false);
          setNotice(
            body.registration_error
              ? t('embeddedConnectedNeedsRegistration')
              : t('embeddedConnected')
          );
        } catch (caught) {
          if (!mountedRef.current) return;
          setConnecting(false);
          setError(
            caught instanceof Error ? caught.message : t('embeddedSaveFailed')
          );
        }
      };

      function handleMessage(event: MessageEvent<unknown>) {
        const message = parseEmbeddedSignupMessage(event);
        if (!message) return;
        if (message.kind === 'cancelled') {
          fail(t('embeddedCancelled'));
          return;
        }
        if (message.kind === 'error') {
          fail(t('embeddedMetaRejected'));
          return;
        }
        session = message;
        void submitWhenReady();
      }

      activeCleanupRef.current = cleanup;
      window.addEventListener('message', handleMessage);
      const timeoutId = window.setTimeout(
        () => fail(t('embeddedUnavailable')),
        60_000
      );

      sdk.login(
        (response) => {
          const returnedCode = response.authResponse?.code;
          if (!returnedCode) {
            fail(t('embeddedCancelled'));
            return;
          }
          code = returnedCode;
          void submitWhenReady();
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        }
      );
    } catch {
      if (!mountedRef.current) return;
      setConnecting(false);
      setError(t('embeddedUnavailable'));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('embeddedTitle')}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('embeddedDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t('embeddedSetupHint')}
        </p>

        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('embeddedLoading')}
          </div>
        ) : config ? (
          <Button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {connecting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('embeddedConnecting')}
              </>
            ) : (
              <>
                <Link2 className="size-4" />
                {t('embeddedConnect')}
              </>
            )}
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t('embeddedNotConfigured')}
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="size-4" />
            <AlertTitle>{t('embeddedUnavailable')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert className="border-emerald-700/50 bg-emerald-950/30">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <AlertTitle className="text-emerald-200">{notice}</AlertTitle>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
