import { describe, expect, it } from 'vitest';
import { renderTemplateBody } from './template-message-text';

describe('renderTemplateBody', () => {
  it('renders the stored template body with the values used for the send', () => {
    expect(
      renderTemplateBody('Hola {{1}}, tu pedido {{2}} está listo.', [
        'Ana',
        'A-42',
      ])
    ).toBe('Hola Ana, tu pedido A-42 está listo.');
  });

  it('keeps an unresolved placeholder visible instead of hiding the body', () => {
    expect(renderTemplateBody('Hola {{1}}', [])).toBe('Hola {{1}}');
  });
});
