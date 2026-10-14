import { useState } from "react";
import { comboText, isMac } from "../lib/keys";
import { useStore } from "../store";
import { Modal } from "./Modal";

const st = () => useStore.getState();
const mod = (k: string) => comboText(`Mod+${k}`);

/** 使い方 (docs/UX.md §9): one screen per job, a few steps each, no website. */
const TOPICS: { id: string; title: string; steps: string[]; note?: string }[] = [
  {
    id: "open",
    title: "開く・保存する",
    steps: [
      "「ホーム」の「開く」を押すか、PDF をこの画面へドロップします。いくつでもタブで並べて開けます。",
      "書き込んだら「保存」を押します。最初の 1 回は「新しいファイルとして保存」か「元のファイルに上書き」かを聞きます。",
      "「新しいファイルとして保存」なら元のファイルはそのまま残ります。上書きしても、前の版はバックアップに残ります（ファイル › バックアップのフォルダを開く）。",
    ],
    note: "保存していない変更は 30 秒ごとに下書きとして残ります。アプリが急に終わっても、次に開いたときに戻せます。",
  },
  {
    id: "markup",
    title: "書き込む（マーカー・文字・付箋）",
    steps: [
      "上の「書き込み」タブを押します。",
      "マーカー：文字をなぞると引けます。文字の無い PDF（スキャン）は、ドラッグで囲みます。",
      "文字を置く：書きたい場所をクリックして入力します。付箋：クリックしてコメントを書きます。",
      "置いたものはクリックで選べます。ドラッグで動かし、右の「詳細」で色や大きさを変え、Delete で消します。",
    ],
    note: `間違えたら「元に戻す」（${mod("Z")}）。道具をやめるには「選択」を押すか Esc。`,
  },
  {
    id: "edit",
    title: "ページの文字を直す",
    steps: [
      "上の「文字と画像」タブの「文字を直す」を押します。直せる行に、うすい点線の枠が出ます。",
      "直したい行をクリックして、そのまま打ちます。Enter か、ほかをクリックで終わります。",
      "もう一度直すには、その行をクリックします。もとの文字に戻すには、行を選んで Delete（右の「詳細」の「もとの文字に戻す」でも）。",
    ],
    note: "保存すると、もとの文字が消えて新しい文字が同じ場所に、もとのフォントで書かれます。そのフォントに無い文字だけ、日本語のフォントになります（右の「詳細」に出ます）。画像になっている文字（スキャン）や、縦書き・斜めの文字は直せません。そのときは「文字を置く」で上から書き足せます。",
  },
  {
    id: "stamp",
    title: "印鑑・署名を押す",
    steps: [
      "「書き込み」タブの「印鑑・画像 ▾」を開きます。",
      "日付印を作る：部署名・日付・名前を入れて「置く」。文字の印を作る：「承認済み」「社外秘」などを選んで「置く」。",
      "手書きの署名を作る：枠にマウスかペンで名前を書くと、ライブラリに入って置けます。次からは「印鑑・画像」のライブラリから押せます。",
      "印鑑の画像（PNG）があれば、ライブラリに加えておけます。背景が透明な PNG がきれいです。",
    ],
  },
  {
    id: "fill",
    title: "入力欄の無い PDF に記入する",
    steps: [
      "上の「入力と署名」タブを押します。",
      "記入：書き入れたい場所をクリックして入力します。入力が終わると「選択」に戻ります。",
      "チェック・バツ・黒丸・横線・日付：付けたい場所をクリックで置けます。",
      "入力欄のある PDF（「入力欄があります」と出たもの）は、欄をクリックしてそのまま入力できます。",
    ],
  },
  {
    id: "pages",
    title: "ページを整理する",
    steps: [
      "上の「ページ」タブを押します。左の一覧のページをドラッグすると並べ替えられます。",
      "「回転」「削除」は、左の一覧で選んだページ（選んでいなければいまのページ）にかかります。",
      "「ファイルからページを足す」で、別の PDF のページをつなげられます（左の一覧へ PDF をドロップしても同じです）。",
      "「ページを抜き出す」で、選んだページだけを新しい PDF にできます。「すべてのページを並べる」で全部を一度に見られます。",
    ],
  },
  {
    id: "print",
    title: "印刷する",
    steps: [
      `「ホーム」の「印刷」（${mod("P")}）を押します。`,
      "印刷するページ、用紙、1 枚に 2 ページなどを選び、「印刷する…」を押します。",
      "パソコンの印刷の画面が開きます。プリンター、部数、両面はそこで選びます。",
    ],
    note: "「書き込みも印刷する」を外すと、元の PDF のページだけを印刷します。",
  },
  {
    id: "trouble",
    title: "困ったとき",
    steps: [
      `元に戻す：${mod("Z")}。やり直す：${mod("Shift+Z")}。`,
      "右上の「何をしますか」に、したいことを言葉で打ちます（「ハンコ」「結合」「小さく」）。",
      "「表示のみ」と出る PDF は、パスワードで保護されているか、Acrobat 専用の形式（XFA）です。書き込みはできません。",
      `画面の文字が小さいときは、設定（${mod(",")}）の「文字の大きさ」で大きくできます。`,
      isMac ? "キーボードの一覧：? キー。" : "キーボードの一覧：? キー。",
    ],
  },
];

export function HelpDialog() {
  const close = () => st().openDialog(null);
  const [id, setId] = useState(TOPICS[0].id);
  const topic = TOPICS.find((t) => t.id === id) ?? TOPICS[0];
  return (
    <Modal title="使い方" onClose={close} width={720}>
      <div className="flex gap-4" style={{ minHeight: 360 }}>
        <nav className="flex w-56 shrink-0 flex-col gap-0.5" aria-label="使い方の項目">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              onClick={() => setId(t.id)}
              aria-current={t.id === id}
              className={`rounded-md px-3 py-2 text-left text-sm ${t.id === id ? "bg-accent text-white" : "hover:bg-hover"}`}
            >
              {t.title}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <h3 className="mb-3 text-base font-semibold">{topic.title}</h3>
          <ol className="flex flex-col gap-3">
            {topic.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{i + 1}</span>
                <span className="text-sm leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
          {topic.note && <p className="mt-4 rounded-md bg-raised p-2.5 text-xs leading-relaxed text-dim">{topic.note}</p>}
        </div>
      </div>
    </Modal>
  );
}
