// App.js — Artifake native (iOS + Android)
// Share any post from TikTok/Instagram/X -> Artifake appears in the share
// sheet -> verdict card. Also: paste a link, or analyze a screenshot.
// Same permissionless ledger as the extension and PWA.
import { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useShareIntent } from "expo-share-intent";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import AsyncStorageShim from "./storage";

const API = "https://flagged-api.vercel.app";
const C = {
  ink: "#17191C", paper: "#F6F7F5", card: "#FFFFFF", rule: "#E3E5E0",
  brand: "#16A34A", brandDeep: "#15803D", ai: "#DC2626", aiDeep: "#B91C1C",
  aiBg: "#FEE2E2", okBg: "#E9F7EE", muted: "#7B8087", warn: "#B45309",
};

export default function App() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  const [url, setUrl] = useState("");
  const [state, setState] = useState({ kind: "idle" }); // idle|loading|flag|clean|analysis|error
  const [myVotes, setMyVotes] = useState({});
  const [key, setKey] = useState(null);

  useEffect(() => {
    (async () => {
      let k = await AsyncStorageShim.get("artifake_key");
      if (!k) { k = "app_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36); await AsyncStorageShim.set("artifake_key", k); }
      setKey(k);
      const v = await AsyncStorageShim.get("artifake_votes");
      if (v) setMyVotes(JSON.parse(v));
    })();
  }, []);

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(API + path, {
      ...opts,
      headers: { "content-type": "application/json", "x-flagged-key": key || "app_anon", ...(opts.headers || {}) },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "request failed"), { status: r.status });
    return data;
  }, [key]);

  const saveVote = async (id, side) => {
    const nv = { ...myVotes, [id]: side };
    setMyVotes(nv);
    await AsyncStorageShim.set("artifake_votes", JSON.stringify(nv));
  };

  // ---- the share-sheet entry point: TikTok/IG/X hand us a url or an image ----
  useEffect(() => {
    if (!hasShareIntent || !key) return;
    const sharedUrl = shareIntent.webUrl || (shareIntent.text || "").match(/https?:\/\/\S+/)?.[0];
    const img = shareIntent.files && shareIntent.files[0];
    if (sharedUrl) { setUrl(sharedUrl); checkUrl(sharedUrl); }
    else if (img && /image/.test(img.mimeType || "")) analyzeFile(img.path);
    resetShareIntent();
  }, [hasShareIntent, key]);

  async function checkUrl(u) {
    if (!/^https?:\/\/.+\..+/.test(u)) { setState({ kind: "error", msg: "Paste a full link, starting with https://" }); return; }
    setState({ kind: "loading", msg: "Checking the public record…" });
    try {
      const { flags } = await api("/v1/flags?url=" + encodeURIComponent(u));
      setState(flags.length ? { kind: "flag", flag: flags[0] } : { kind: "clean", url: u });
    } catch (e) { setState({ kind: "error", msg: e.message }); }
  }

  async function flagIt(u) {
    setState({ kind: "loading", msg: "Adding to the record…" });
    try {
      const { flag } = await api("/v1/flags", { method: "POST", body: JSON.stringify({ url: u, signals: ["detector"], note: "Flagged from the Artifake app" }) });
      await saveVote(flag.id, "confirm");
      setState({ kind: "flag", flag });
    } catch (e) { setState({ kind: "error", msg: e.message }); }
  }

  async function vote(flag, side) {
    try {
      const { flag: updated } = await api(`/v1/flags/${flag.id}/votes`, { method: "POST", body: JSON.stringify({ side }) });
      await saveVote(flag.id, side);
      setState({ kind: "flag", flag: updated });
    } catch (e) {
      if (e.status === 409) { await saveVote(flag.id, "confirm"); setState({ kind: "flag", flag }); }
      else setState({ kind: "error", msg: e.message });
    }
  }

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!res.canceled && res.assets[0]) analyzeFile(res.assets[0].uri);
  }

  async function analyzeFile(uri) {
    setState({ kind: "loading", msg: "Analyzing image… a few seconds" });
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const mt = uri.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";
      const d = await api("/v1/analyze-upload", { method: "POST", body: JSON.stringify({ image_base64: b64, media_type: mt }) });
      setState({ kind: "analysis", data: d });
    } catch (e) { setState({ kind: "error", msg: e.status === 501 ? "Analysis not enabled on the server" : e.message }); }
  }

  // ---------- render ----------
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <View style={s.logoTile}><View style={s.logoPole} /><View style={s.logoPennant} /></View>
          <Text style={s.wm}>Arti<Text style={{ color: C.ai }}>fake</Text></Text>
        </View>

        <Text style={s.h1}>Is it AI? Check anything.</Text>
        <Text style={s.sub}>Share a post from any app, paste a link, or analyze a screenshot.</Text>

        <View style={s.panel}>
          <TextInput
            style={s.input} value={url} onChangeText={setUrl}
            placeholder="https://…" placeholderTextColor={C.muted}
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
            onSubmitEditing={() => checkUrl(url.trim())}
          />
          <TouchableOpacity style={s.primary} onPress={() => checkUrl(url.trim())}>
            <Text style={s.primaryTxt}>Check the record</Text>
          </TouchableOpacity>
          <Text style={s.or}>or</Text>
          <TouchableOpacity style={s.upload} onPress={pickImage}>
            <Text style={s.uploadTxt}>📷  Analyze a screenshot</Text>
          </TouchableOpacity>
        </View>

        {state.kind === "loading" && (
          <View style={s.panel}><ActivityIndicator color={C.brand} /><Text style={s.loadingTxt}>{state.msg}</Text></View>
        )}

        {state.kind === "error" && (
          <View style={s.panel}><Text style={{ color: C.aiDeep, fontWeight: "600" }}>{state.msg}</Text></View>
        )}

        {state.kind === "clean" && (
          <View style={s.panel}>
            <Badge cls="ok" label="no flags on record" />
            <Text style={s.note}>Nobody has flagged this yet. Think it's AI? Put it on the record.</Text>
            <TouchableOpacity style={[s.primary, { backgroundColor: C.ai }]} onPress={() => flagIt(state.url)}>
              <Text style={s.primaryTxt}>Flag as AI</Text>
            </TouchableOpacity>
            <Text style={s.fine}>Flags are public. Submitting counts as your confirm vote.</Text>
          </View>
        )}

        {state.kind === "flag" && <FlagCard flag={state.flag} myVote={myVotes[state.flag.id]} onVote={vote} />}

        {state.kind === "analysis" && <AnalysisCard data={state.data} />}

        <Text style={s.footer}>Artifake · the public record of AI-generated content{"\n"}Open API · no accounts · community-settled</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Badge({ cls, label }) {
  const map = { ai: [C.aiDeep, C.aiBg], ok: [C.brandDeep, C.okBg], warn: [C.warn, "#FFF"], gray: [C.muted, "#FFF"] };
  const [color, bg] = map[cls] || map.gray;
  return (
    <View style={[s.badge, { borderColor: color, backgroundColor: bg }]}>
      <Text style={{ color, fontWeight: "800", fontSize: 11, letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
    </View>
  );
}

function FlagCard({ flag, myVote, onVote }) {
  const total = (flag.votes.confirm || 0) + (flag.votes.dispute || 0);
  const badge = flag.status === "confirmed" ? ["ai", "⚑ AI · confirmed"]
    : flag.status === "disputed" ? ["ok", "overruled by the crowd"]
    : flag.status === "contested" ? ["warn", "contested"]
    : ["gray", "AI · unverified"];
  return (
    <View style={s.panel}>
      <Badge cls={badge[0]} label={badge[1]} />
      {!!flag.note && <Text style={s.note}>{flag.note}</Text>}
      <Text style={s.counts}>{flag.votes.confirm || 0} confirm · {flag.votes.dispute || 0} dispute{total < 3 ? ` · needs ${3 - total} more` : ""}</Text>
      <View style={s.vrow}>
        <TouchableOpacity
          style={[s.vbtn, { borderColor: C.ai }, myVote === "confirm" && { backgroundColor: C.ai }]}
          disabled={!!myVote} onPress={() => onVote(flag, "confirm")}>
          <Text style={[{ color: C.ai, fontWeight: "700" }, myVote === "confirm" && { color: "#fff" }]}>{myVote === "confirm" ? "✓ Confirmed" : "Confirm AI"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.vbtn, { borderColor: C.rule }, myVote === "dispute" && { backgroundColor: C.muted }]}
          disabled={!!myVote} onPress={() => onVote(flag, "dispute")}>
          <Text style={[{ color: "#52575C", fontWeight: "700" }, myVote === "dispute" && { color: "#fff" }]}>{myVote === "dispute" ? "✓ Disputed" : "Dispute"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AnalysisCard({ data }) {
  const cats = {
    ai_generated: ["ai", "AI-generated"],
    ai_edited: ["ai", "AI-edited · altered"],
    likely_real: ["gray", "no artifacts detected · not proof it's real"],
    unclear: ["gray", "inconclusive"],
  };
  const [cls, label] = cats[data.category] || cats.unclear;
  return (
    <View style={s.panel}>
      <Badge cls={cls} label={label + (data.likelihood >= 0.5 ? ` · ${Math.round(data.likelihood * 100)}%` : "")} />
      {(data.signals || []).map((sig, i) => (
        <View key={i} style={s.sig}>
          <Text style={{ fontWeight: "700", fontSize: 13 }}>{sig.label}</Text>
          <Text style={{ color: C.muted, fontSize: 12.5, marginTop: 2 }}>{sig.evidence}</Text>
        </View>
      ))}
      <Text style={s.fine}>LLM analysis · model judgment, not proof · image not stored</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper },
  body: { padding: 20, paddingBottom: 60, maxWidth: 560, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 18 },
  logoTile: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.brandDeep, overflow: "hidden" },
  logoPole: { position: "absolute", left: 13, top: 4, width: 3, height: 22, backgroundColor: "#fff", borderRadius: 2 },
  logoPennant: { position: "absolute", left: 16, top: 4, width: 0, height: 0, borderTopWidth: 5, borderBottomWidth: 5, borderLeftWidth: 10, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: C.ai },
  wm: { fontSize: 20, fontWeight: "800", color: C.ink },
  h1: { fontSize: 26, fontWeight: "800", color: C.ink, letterSpacing: -0.3 },
  sub: { color: C.muted, marginTop: 8, fontSize: 14 },
  panel: { backgroundColor: C.card, borderWidth: 1, borderColor: C.rule, borderRadius: 14, padding: 16, marginTop: 16 },
  input: { borderWidth: 1.5, borderColor: C.rule, borderRadius: 10, backgroundColor: C.paper, padding: 13, fontSize: 15, color: C.ink },
  primary: { marginTop: 10, backgroundColor: C.brand, borderRadius: 10, padding: 14, alignItems: "center" },
  primaryTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  or: { textAlign: "center", color: C.muted, fontSize: 12, marginTop: 12 },
  upload: { marginTop: 10, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.rule, borderRadius: 10, padding: 13, alignItems: "center" },
  uploadTxt: { fontWeight: "700", color: C.ink, fontSize: 14 },
  loadingTxt: { textAlign: "center", color: C.muted, marginTop: 10 },
  badge: { alignSelf: "flex-start", borderWidth: 1.5, borderRadius: 5, paddingHorizontal: 9, paddingVertical: 4 },
  note: { marginTop: 10, fontSize: 14, color: C.ink },
  counts: { marginTop: 8, fontSize: 11.5, color: C.muted, fontVariant: ["tabular-nums"] },
  vrow: { flexDirection: "row", gap: 8, marginTop: 12 },
  vbtn: { flex: 1, borderWidth: 1.5, borderRadius: 999, padding: 10, alignItems: "center" },
  sig: { backgroundColor: C.paper, borderWidth: 1, borderColor: C.rule, borderRadius: 9, padding: 10, marginTop: 8 },
  fine: { marginTop: 10, fontSize: 11, color: C.muted },
  footer: { textAlign: "center", color: C.muted, fontSize: 11.5, marginTop: 28, lineHeight: 18 },
});
