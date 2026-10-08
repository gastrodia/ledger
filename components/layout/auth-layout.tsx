import { ReactNode } from "react";
import { ArrowDownLeft, Check, Coffee, MessageCircle, Utensils } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/brand/brand-logo";
import { BRAND_NAME } from "@/lib/brand";
import styles from "./auth-layout.module.css";

interface AuthLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BrandLogo className={styles.logo} />
      </header>
      <main className={styles.main}>
        <section className={styles.story} aria-label={`认识 ${BRAND_NAME}`}>
          <div className={styles.eyebrow}><span /> 记账这件小事，可以更轻松</div>
          <h2 className={styles.headline}>让每一笔，<br /><span>都心里有数。</span></h2>
          <p className={styles.description}>说一句，拍一张。<br />把日常收支，慢慢记成生活的模样。</p>
          <figure className={styles.demo} aria-label="AI 整理账目的功能示意">
            <figcaption className={styles.demoLabel}>比如，今天的一顿午饭</figcaption>
            <div className={styles.message}><MessageCircle size={17} aria-hidden="true" /><span>午饭 32 元，咖啡 18 元</span></div>
            <div className={styles.receipt}>
              <div className={styles.receiptHeader}>
                <span className={styles.assistantMark}><BrandMark /></span>
                <span>帮你整理好了</span><span className={styles.draftBadge}>待确认</span>
              </div>
              <div className={styles.receiptRow}>
                <span className={styles.expenseIcon}><Utensils size={17} aria-hidden="true" /></span>
                <span>午饭<small>餐饮</small></span><strong>¥ 32.00</strong>
              </div>
              <div className={styles.receiptRow}>
                <span className={styles.expenseIcon}><Coffee size={17} aria-hidden="true" /></span>
                <span>咖啡<small>餐饮</small></span><strong>¥ 18.00</strong>
              </div>
              <div className={styles.receiptFooter}>
                <span><Check size={14} aria-hidden="true" /> 你来确认，才会入账</span><span>功能示意</span>
              </div>
            </div>
            <ArrowDownLeft className={styles.demoArrow} strokeWidth={1.2} aria-hidden="true" />
          </figure>
          <p className={styles.storyFootnote}>日常收支<span>·</span>人情往来<span>·</span>一家人的账本</p>
        </section>
        <div className={styles.mobileIntro}>
          <p>让每一笔，<span>都心里有数。</span></p>
          <span>说一句，拍一张，轻松记账。</span>
        </div>
        <section className={styles.panel} aria-labelledby="auth-title">
          <div className={styles.panelHeader}>
            <span className={styles.panelKicker}>你的家庭生活账本</span>
            <h1 id="auth-title">{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className={styles.formContent}>{children}</div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} {BRAND_NAME}</span><span>认真生活，轻松记账。</span>
      </footer>
    </div>
  );
}
