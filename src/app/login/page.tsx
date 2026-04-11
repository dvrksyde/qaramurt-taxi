"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      login,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.ok) {
      router.push("/monitor");
    } else {
      setError("Неверный логин или пароль");
    }
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginBox}>
        <div className={styles.loginLogo}>
          <Image src="/logo-transparent.png" alt="Qaramurt Taxi" width={100} height={100} className={styles.logoImg} priority />
          <h1 className={styles.logoTitle}>Qaramurt Taxi</h1>
          <p className={styles.logoSub}>Система диспетчеризации</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.loginForm}>
          <div className={styles.field}>
            <label htmlFor="login">Логин</label>
            <input
              id="login"
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Введите логин"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль"
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.loginBtn} disabled={loading}>
            {loading ? "Вход..." : "Войти"}
          </button>
        </form>

        <div className={styles.loginFooter}>
          © Qaramurt Taxi, 2024–2026
        </div>
      </div>
    </div>
  );
}
