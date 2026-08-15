import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { signOut } from 'firebase/auth';
import { auth } from '../../lib/firebase';

export default function Dashboard() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) {
      router.push('/');
    } else {
      setToken(t);
    }
  }, []);

  async function handleLogout() {
    await signOut(auth);
    localStorage.removeItem('token');
    router.push('/');
  }

  async function importarTrabalhadores() {
    setLoading(true);
    try {
      const res = await fetch('/api/importInvites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          orgId: 'org-teste',
          roundId: 'rodada-2026',
          workers: [
            { stableId: 'matricula-001', unitId: 'operacoes' },
            { stableId: 'matricula-002', unitId: 'operacoes' },
          ],
        }),
      });
      const data = await res.json();
      alert('Convites gerados: ' + data.invitesGenerated);
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '600px', margin: '20px auto', fontFamily: 'monospace' }}>
      <h1>Dashboard RH</h1>
      <button onClick={handleLogout} style={{ padding: '8px 16px', marginBottom: '20px' }}>
        Sair
      </button>

      <h2>Rodadas</h2>
      <p>rodada 2026 — em andamento</p>

      <h2>Ações</h2>
      <button onClick={importarTrabalhadores} disabled={loading} style={{ padding: '8px 16px' }}>
        {loading ? 'importando...' : 'importar trabalhadores'}
      </button>
    </div>
  );
          }
