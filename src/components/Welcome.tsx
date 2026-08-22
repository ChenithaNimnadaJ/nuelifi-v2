type WelcomeProps = { signedIn: boolean; onContinue: () => void; onSignUp: () => void };

export function Welcome({ signedIn, onContinue, onSignUp }: WelcomeProps) {
  return <main className="welcome-page">
    <div className="welcome-card">
      <span className="public-kicker">WELCOME TO NEULIFI</span>
      <div className="welcome-mark" aria-hidden="true">✓</div>
      <h1>Your Neulifi space is ready.</h1>
      <p>{signedIn ? "Your subscription will appear in your account as soon as Paddle confirms the notification. You can continue into Neulifi now." : "Your checkout was completed. Sign in or create the account that should receive the subscription so we can connect it to your Neulifi space."}</p>
      <div className="welcome-actions">
        <button className="button button-green" type="button" onClick={signedIn ? onContinue : onSignUp}>{signedIn ? "Continue to Neulifi" : "Continue to sign in"} <span aria-hidden="true">→</span></button>
        <small>Neulifi is a nutrition and lifestyle companion, not medical care.</small>
      </div>
    </div>
  </main>;
}
