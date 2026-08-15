import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Questionario() {
  const router = useRouter();
  const { code } = router.query;
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await fetch('/api/submitResponse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: 'org-teste',
          roundId: 'rodada-2026',
          code,
          answers,
        }),
      });
      if (res.ok) {
        alert('Resposta enviada!');
        router.push('/obrigado');
      } else {
        const err = await res.json();
        alert('Erro: ' + err.error);
      }
    } catch (err) {
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '500px', margin: '20px auto', fontFamily: 'monospace' }}>
      <h1>Questionário</h1>
      <p>🔒 Sua resposta só aparece combinada com a de outras pessoas — nunca sozinha.</p>

      <h2>Carga de trabalho</h2>
      <select
        onChange={(e) => setAnswers({ ...answers, carga_trabalho: e.target.value })}
        style={{ width: '100%', padding: '8px' }}
      >
        <option>selecione...</option>
        <option>nunca</option>
        <option>às vezes</option>
        <option>frequentemente</option>
        <option>sempre</option>
      </select>

      <button onClick={handleSubmit} disabled={loading} style={{ marginTop: '20px', padding: '8px 16px' }}>
        {loading ? 'enviando...' : 'enviar resposta'}
      </button>
    </div>
  );
}
