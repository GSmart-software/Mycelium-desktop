import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.brand}>
        <h1 className={styles.title}>Micelio</h1>
        <p className={styles.tagline}>Tu red de conocimiento, viva y conectada</p>
      </div>
    </main>
  );
}
