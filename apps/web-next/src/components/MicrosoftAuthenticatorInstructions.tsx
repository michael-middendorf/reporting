export function MicrosoftAuthenticatorInstructions({ setup, hasQr = true }: { setup: boolean; hasQr?: boolean }) {
  if (!setup) return <p>Open Microsoft Authenticator and select the AMU Academic Affairs entry you added for Reporting. Enter its current 6-digit code below, then select Verify.</p>;
  return <section aria-label="Set up Microsoft Authenticator">
    <h2>Set up Microsoft Authenticator</h2>
    <ol>
      <li>On your phone, open Microsoft Authenticator. Install it from your phone app store if needed.</li>
      <li>Tap + (Add account).</li>
      <li>Choose Other account. This Reporting code uses a separate entry from your University account.</li>
      <li>{hasQr ? "Allow camera access and scan the QR code on this page." : "Select Enter code manually and enter the account name AMU Academic Affairs and the key below."}</li>
      <li>Open the new AMU Academic Affairs entry and type its current 6-digit code into the field below.</li>
      <li>Select Verify to finish setup.</li>
    </ol>
    <p>Keep your existing University account in Microsoft Authenticator. Use the new AMU Academic Affairs entry for this Reporting code.</p>
    {hasQr && <p>Cannot scan? In Microsoft Authenticator, choose Enter code manually. Use AMU Academic Affairs as the account name and enter the key shown below.</p>}
  </section>;
}
