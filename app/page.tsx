import metrics from './data/metrics.json';
import Dashboard from './components/Dashboard';
import type { Metrics } from './lib/model';

export default function Page() {
  return <Dashboard data={metrics as unknown as Metrics} />;
}
