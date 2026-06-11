import styles from "./auth.module.css";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.brand}>
          <h1 className={styles.logo}>Micelio</h1>
          <p className={styles.tagline}>Tu red de conocimiento, viva y conectada</p>
        </header>
        {children}
      </div>
    </main>
  );
}
