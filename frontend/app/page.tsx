import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.brand}>
        <h1 className={styles.title}>Mycelium</h1>
        <p className={styles.tagline}>Tu red de conocimiento, viva y conectada</p>
        <div className={styles.actions}>
          <Link className={styles.cta} href="/login">
            Iniciar sesión
          </Link>
          <Link className={styles.ctaSecondary} href="/register">
            Crear cuenta
          </Link>
        </div>
      </div>
    </main>
  );
}
