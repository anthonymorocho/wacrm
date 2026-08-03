import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { mergeMessages, resolveLocale } from './locales';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = resolveLocale({
    cookie: cookieStore.get('NEXT_LOCALE')?.value,
    acceptLanguage: headerStore.get('accept-language'),
    configured: process.env.NEXT_PUBLIC_APP_LOCALE,
  });

  const english = (await import('../../messages/en.json')).default;
  let translated = english;
  try {
    translated = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // English remains the complete source dictionary.
  }

  return {
    locale,
    messages: locale === 'en' ? english : mergeMessages(english, translated),
  };
});
