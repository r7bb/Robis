import { LoginForm } from './login-form.tsx';

/**
 * Sign in, or with `?mode=register` sign up. Read here, on the server, so
 * the right form is in the first paint rather than swapped in after it.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { mode } = await searchParams;
  return <LoginForm initialMode={mode === 'register' ? 'register' : 'login'} />;
}
