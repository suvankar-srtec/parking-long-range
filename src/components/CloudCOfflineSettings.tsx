export default function CloudCOfflineSettings({ serial }: { serial: string }) {
  return <section className="reader-card" aria-label={`Controller ${serial} offline verification`}>
    <h3>Cloud C {serial} - shared offline memory</h3>
    <p>When the server is unreachable, a powered controller in Online first mode automatically verifies scanned cards against its stored memory.</p>
    <p>This memory is shared by both reader inputs. No separate memory setup is needed for reader A or B.</p>
    <p className="muted">Only cards already saved in the controller can be verified offline. For controller 80M236, registered numeric RFID cards are automatically copied to verified app-managed memory while connected. Permissions renew hourly and expire after 24 hours without renewal. Offline access follows the controller's saved permissions; live website rules require a connection.</p>
  </section>;
}
