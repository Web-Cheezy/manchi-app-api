'use client';

import { useEffect, useState } from 'react';

type Status = 'healthy' | 'unhealthy' | 'degraded' | 'unknown';

interface HealthCheck {
  status: Status;
  message: string;
}

interface HealthResponse {
  status: Status;
  timestamp: string;
  checks: {
    paystack: HealthCheck;
    database: HealthCheck;
    env: HealthCheck;
  };
}

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setHealth(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const StatusIcon = ({ status }: { status: Status }) => {
    if (status === 'healthy') return <span className="text-green-500 text-xl">●</span>;
    if (status === 'degraded') return <span className="text-yellow-500 text-xl">●</span>;
    if (status === 'unhealthy') return <span className="text-red-500 text-xl">●</span>;
    return <span className="text-gray-400 text-xl">●</span>;
  };

  const StatusBadge = ({ status }: { status: Status }) => {
    const colors = {
      healthy: 'bg-green-100 text-green-800 border-green-200',
      unhealthy: 'bg-red-100 text-red-800 border-red-200',
      degraded: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      unknown: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[status] || colors.unknown}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 p-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">System Status</h1>
            <p className="text-gray-500">Backend Proxy for Flutter App</p>
        </div>

        {/* Content */}
        <div className="p-8">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
            </div>
          ) : !health ? (
             <div className="text-center text-red-500 py-12">Failed to load system status.</div>
          ) : (
            <div className="space-y-6">
              
              {/* Overall Status */}
              <div className="flex items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-100">
                <span className="font-semibold text-gray-700">Overall Health</span>
                <StatusBadge status={health.status} />
              </div>

              <div className="grid gap-4 md:grid-cols-1">
                {/* Environment Variables */}
                <div className="flex items-start p-4 border border-gray-100 rounded-lg hover:shadow-md transition-shadow">
                  <div className="mt-1 mr-4"><StatusIcon status={health.checks.env.status} /></div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Configuration</h3>
                    <p className="text-sm text-gray-500 mt-1">{health.checks.env.message}</p>
                  </div>
                </div>

                {/* Database */}
                <div className="flex items-start p-4 border border-gray-100 rounded-lg hover:shadow-md transition-shadow">
                  <div className="mt-1 mr-4"><StatusIcon status={health.checks.database.status} /></div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Database (Supabase)</h3>
                    <p className="text-sm text-gray-500 mt-1">{health.checks.database.message}</p>
                  </div>
                </div>

                {/* Paystack */}
                <div className="flex items-start p-4 border border-gray-100 rounded-lg hover:shadow-md transition-shadow">
                  <div className="mt-1 mr-4"><StatusIcon status={health.checks.paystack.status} /></div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Paystack Connectivity</h3>
                    <p className="text-sm text-gray-500 mt-1">{health.checks.paystack.message}</p>
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-400 text-center mt-8">
                Last checked: {new Date(health.timestamp).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
