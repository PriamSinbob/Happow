import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactsSection } from '../src/components/Contacts';
import { I18nProvider } from '../src/i18n';

/** The friends' switch on the account card sends what was ticked. */

const api = vi.hoisted(() => vi.fn(async () => ({})));
const refresh = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../src/api', async (orig) => ({ ...(await orig<typeof import('../src/api')>()), api }));
vi.mock('../src/auth', async (orig) => ({
  ...(await orig<typeof import('../src/auth')>()),
  accessToken: async () => 'token',
}));
vi.mock('../src/account', async (orig) => ({
  ...(await orig<typeof import('../src/account')>()),
  useAccount: () => ({ me: { displayName: 'Ala', friendsVisible: false }, refresh }),
}));
vi.mock('../src/contacts', async (orig) => ({
  ...(await orig<typeof import('../src/contacts')>()),
  loadContacts: async () => ({ link: null, contacts: [], groups: [] }),
}));

describe('the friends switch', () => {
  afterEach(cleanup);

  it('turns on: the box is read before React puts it back to the stored value', async () => {
    render(
      <I18nProvider initial="en">
        <ContactsSection />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByLabelText(/Show my friends when I'm going/));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('me', {
      token: 'token',
      method: 'PUT',
      body: { friendsVisible: true },
    });
  });
});

describe('the name friends see', () => {
  afterEach(cleanup);

  it('is a field with Save on the card, not a link to another window', async () => {
    render(
      <I18nProvider initial="en">
        <ContactsSection />
      </I18nProvider>,
    );
    const field = (await screen.findByLabelText('Your name')) as HTMLInputElement;
    expect(field.value).toBe('Ala');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    // Nothing to save until it changes.
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'Ala K.' } });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/));
    expect(api).toHaveBeenCalledWith('me', {
      token: 'token',
      method: 'PUT',
      body: { displayName: 'Ala K.' },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
