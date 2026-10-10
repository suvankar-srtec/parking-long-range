export default function CloudCOfflineSettings({ serial }: { serial: string }) {
  return <section className="reader-card" aria-label={`Controller ${serial} offline verification`}>
    <h3>Cloud C {serial} - shared offline memory</h3>
    <p>When the server is unreachable, a powered controller in Online first mode automatically verifies scanned cards against its stored memory.</p>
    <p>This memory is shared by both reader inputs. No separate memory setup is needed for reader A or B.</p>
    <p className="muted">Only cards already saved in the controller can be verified offline. Cards registered only on this website are not automatically saved to controller memory. Offline access follows the controller's saved permissions; live website rules require a connection.</p>
  </section>;
}
