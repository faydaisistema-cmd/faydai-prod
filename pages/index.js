import { useState } from 'react';
import { useRouter } from 'next/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const token = await cred.user.getIdToken();
      // Guarda token em sessão/localStorage pra usar depois
      localStorage.setItem('token', token);
      router.push('/rh/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'monospace' }}>
      <h1>Entrar</h1>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="e-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: '100%', marginBottom: '10px', padding: '8px' }}
        />
        <input
          type="password"
          placeholder="senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', marginBottom: '10px', padding: '8px' }}
        />
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '8px' }}>
          {loading ? 'entrando...' : 'entrar'}
        </button>
      </form>
      {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
    </div>
  );
}
