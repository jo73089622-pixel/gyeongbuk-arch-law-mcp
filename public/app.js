// 수전설비 용량 조회 화면. 모든 값은 textContent로 넣어 HTML로 해석되지 않게 한다.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fmt = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

  const el = {
    status: $("status"),
    form: $("search-form"),
    sido: $("sido"),
    sigungu: $("sigungu"),
    codeField: $("code-field"),
    code: $("sigungu-code"),
    keyword: $("keyword"),
    months: $("months"),
    category: $("category"),
    latestOnly: $("latest-only"),
    refresh: $("refresh"),
    searchBtn: $("search-btn"),
    cancelBtn: $("cancel-btn"),
    progress: $("progress"),
    progressFill: $("progress-fill"),
    progressText: $("progress-text"),
    searchError: $("search-error"),
    resultSection: $("result-section"),
    resultSummary: $("result-summary"),
    resultWarnings: $("result-warnings"),
    noData: $("no-data"),
    tableWrap: $("table-wrap"),
    tbody: document.querySelector("#result-table tbody"),
    resultNotes: $("result-notes"),
    chatLog: $("chat-log"),
    chatForm: $("chat-form"),
    chatInput: $("chat-input"),
    chatSend: $("chat-send"),
    chatReset: $("chat-reset"),
  };

  let source = null;
  let gotResult = false;
  let chatSessionId = null;
  let allRegions = [];

  function node(tag, text, className) {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (className) n.className = className;
    return n;
  }

  function fillList(listEl, items) {
    listEl.replaceChildren(...items.map((t) => node("li", t)));
  }

  function chip(label, ok) {
    return node("li", `${label}: ${ok ? "설정됨" : "미설정"}`, `chip ${ok ? "ok" : "missing"}`);
  }

  // ---- 초기 설정 ----
  async function loadStatus() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const s = await res.json();
      el.status.replaceChildren(
        chip("전기안전공사 인증키", s.kescoKeyConfigured),
        chip("Claude API 키", s.claudeKeyConfigured),
        node("li", `AI 모델: ${s.model}`, "chip")
      );
      allRegions = s.regions;
      const sidoOptions = s.sidoList.map((x) => {
        const o = node("option", x.name);
        o.value = x.code;
        return o;
      });
      el.sido.replaceChildren(...sidoOptions);
      el.sido.value = s.defaultSido;
      fillSigungu();
      el.months.value = String(s.defaultMonths);
      el.months.max = String(s.maxMonths);
      fillList($("about-legal"), s.legalBasis);
      fillList($("about-sources"), s.dataSources);
      $("about-unit").textContent = s.unitNote;
      fillList($("about-limits"), s.limitations);
      fillList($("about-unverified"), s.unverified);
      $("official-link").href = s.links.officialLookup;
    } catch (err) {
      el.status.replaceChildren(node("li", "서버 설정을 불러오지 못했습니다. 서버가 켜져 있는지 확인하십시오.", "chip missing"));
    }
  }

  function fillSigungu() {
    const first = node("option", "시군구를 고르십시오");
    first.value = "";
    const options = [first];
    for (const r of allRegions.filter((x) => x.sidoCode === el.sido.value)) {
      const o = node("option", r.isDistrict ? `　${r.name}` : r.name);
      o.value = r.code;
      if (r.note) o.title = r.note;
      options.push(o);
    }
    const other = node("option", "시군구코드 직접 입력");
    other.value = "__code__";
    options.push(other);
    el.sigungu.replaceChildren(...options);
    el.codeField.hidden = true;
  }

  el.sido.addEventListener("change", fillSigungu);

  el.sigungu.addEventListener("change", () => {
    el.codeField.hidden = el.sigungu.value !== "__code__";
  });

  // ---- 조회 ----
  function setSearching(on) {
    el.searchBtn.disabled = on;
    el.cancelBtn.hidden = !on;
    el.progress.hidden = !on;
  }

  function showSearchError(message) {
    el.searchError.textContent = message;
    el.searchError.hidden = false;
  }

  function stopSource() {
    if (source) {
      source.close();
      source = null;
    }
  }

  function numCell(value, raw) {
    if (value === 0) return "0 (원문 값)";
    if (value !== null && value !== undefined) return fmt.format(value);
    return raw ? `${raw} (원문)` : "-";
  }

  function renderResult(result) {
    el.resultSection.hidden = false;
    const c = result.counts;
    const parts = [
      `${result.region.name}`,
      `${result.period.from} ~ ${result.period.to} (${result.period.months}개월)`,
      `구분 ${result.query.category}`,
      result.query.keyword ? `검색어 “${result.query.keyword}”` : "검색어 없음",
    ];
    el.resultSummary.textContent =
      `${parts.join(" · ")} — 받은 기록 ${fmt.format(c.fetchedRecords)}건 중 조건에 맞는 기록 ${fmt.format(c.matchedRecords)}건` +
      (result.query.latestOnly ? `, 시설별 최신 ${fmt.format(c.distinctRecords)}건` : "") +
      `. 표시 ${fmt.format(c.returnedRecords)}건${c.truncated ? " (검색어로 좁히면 나머지를 볼 수 있습니다)" : ""}.` +
      ` 저장본 ${c.monthsFromCache}개월 · 새로 받음 ${c.monthsFromApi}개월.`;

    const warnings = [];
    if (result.failedMonths.length > 0) {
      warnings.push(`받지 못한 달 ${result.failedMonths.length}개월(${result.failedMonths.map((f) => f.month).join(", ")}) — 결과가 불완전합니다. 잠시 후 다시 조회하십시오.`);
    }
    if (result.monthMessages.length > 0) {
      warnings.push(`안내 문구가 온 달: ${result.monthMessages.map((m) => `${m.month} “${m.message}”`).join(", ")}`);
    }
    if (result.region.note) warnings.push(`지역 유의사항: ${result.region.note}`);
    el.resultWarnings.replaceChildren(...warnings.map((w) => node("p", w, "warning")));

    el.tbody.replaceChildren();
    const empty = result.records.length === 0;
    el.noData.hidden = !empty;
    el.tableWrap.hidden = empty;
    for (const r of result.records) {
      const tr = document.createElement("tr");
      const name = node("td", r.businessName ?? "-");
      if (r.industry) name.append(node("span", r.industry, "sub"));
      const addr = node("td", r.roadAddress ?? r.lotAddress ?? "-");
      if (r.roadAddress && r.lotAddress && r.lotAddress !== r.roadAddress) addr.append(node("span", `지번 ${r.lotAddress}`, "sub"));
      const kind = node("td", [r.inspectionType, r.inspectionKind].filter(Boolean).join(" · ") || "-");
      if (r.equipmentType) kind.append(node("span", r.equipmentType, "sub"));
      tr.append(
        name,
        addr,
        node("td", numCell(r.receivingVoltageV, r.raw.receivingVoltage), "num"),
        node("td", numCell(r.receivingCapacityKw, r.raw.receivingCapacity), "num cap"),
        node("td", numCell(r.generationCapacityKw, r.raw.generationCapacity), "num"),
        node("td", r.category ?? "-"),
        kind,
        node("td", r.inspectionEnd ?? r.inspectionStart ?? "-"),
        node("td", r.result ?? "-"),
        node("td", r.safetyGrade ?? "-")
      );
      el.tbody.append(tr);
    }
    fillList(el.resultNotes, result.notes);
    el.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  el.form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    el.searchError.hidden = true;
    let sigungu = el.sigungu.value;
    if (sigungu === "__code__") sigungu = el.code.value.trim();
    if (!sigungu) {
      showSearchError("시군구를 고르십시오.");
      return;
    }
    if (!/^\d{5}$/.test(sigungu)) {
      showSearchError("시군구코드는 숫자 5자리로 입력하십시오.");
      return;
    }
    const months = Number(el.months.value);
    if (!Number.isInteger(months) || months < 1 || months > Number(el.months.max || 60)) {
      showSearchError(`조회 기간은 1~${el.months.max || 60}개월 사이로 입력하십시오.`);
      return;
    }

    const params = new URLSearchParams({
      sigungu,
      keyword: el.keyword.value.trim(),
      months: String(months),
      category: el.category.value,
      latestOnly: el.latestOnly.checked ? "1" : "0",
      refresh: el.refresh.checked ? "1" : "0",
    });

    stopSource();
    gotResult = false;
    setSearching(true);
    el.progressFill.style.width = "0%";
    el.progressText.textContent = "조회를 시작합니다…";

    source = new EventSource(`/api/search?${params}`);
    source.addEventListener("progress", (e) => {
      const p = JSON.parse(e.data);
      const pct = Math.round((p.done / p.total) * 100);
      el.progressFill.style.width = `${pct}%`;
      el.progressFill.parentElement.setAttribute("aria-valuenow", String(pct));
      const how = { cache: "저장본 사용", api: "새로 받음", message: "안내 문구", failed: "받지 못함" }[p.source] || p.source;
      el.progressText.textContent = `${p.done}/${p.total}개월 조회 중 — ${p.month} (${how})`;
    });
    source.addEventListener("result", (e) => {
      gotResult = true;
      stopSource();
      setSearching(false);
      renderResult(JSON.parse(e.data));
    });
    source.addEventListener("failure", (e) => {
      gotResult = true;
      stopSource();
      setSearching(false);
      showSearchError(JSON.parse(e.data).message);
    });
    source.addEventListener("error", () => {
      // 연결이 끊기면 자동 재연결(재조회)되지 않도록 닫는다.
      if (!gotResult) showSearchError("서버와의 연결이 끊겼습니다. 서버가 켜져 있는지 확인하고 다시 조회하십시오.");
      stopSource();
      setSearching(false);
    });
  });

  el.cancelBtn.addEventListener("click", () => {
    gotResult = true;
    stopSource();
    setSearching(false);
    showSearchError("조회를 중지했습니다. 이미 받은 달의 자료는 저장되어 다음 조회 때 다시 씁니다.");
  });

  // ---- AI 도우미 ----
  function addMessage(kind, text, meta) {
    const m = node("div", text, `msg ${kind}`);
    if (meta) m.append(node("span", meta, "meta"));
    el.chatLog.append(m);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    return m;
  }

  async function sendChat() {
    const message = el.chatInput.value.trim();
    if (!message) return;
    el.chatInput.value = "";
    addMessage("user", message);
    const pending = addMessage("bot pending", "답변을 작성하고 있습니다… (처음 조회하는 시군은 시간이 걸릴 수 있습니다)");
    el.chatSend.disabled = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: chatSessionId, message }),
      });
      const data = await res.json().catch(() => ({}));
      pending.remove();
      if (!res.ok) {
        addMessage("err", data.error || `오류가 발생했습니다 (HTTP ${res.status}).`);
        return;
      }
      chatSessionId = data.sessionId;
      const calls = data.toolCalls.map((c) => `${c.ok ? "조회" : "조회 실패"}: ${c.summary}`);
      const meta = [
        ...calls,
        `모델 ${data.model} · 요청 ${data.usage.requests}회 · 입력 ${fmt.format(data.usage.inputTokens)} / 출력 ${fmt.format(data.usage.outputTokens)} 토큰`,
      ].join("\n");
      addMessage("bot", data.answer, meta);
    } catch (err) {
      pending.remove();
      addMessage("err", "서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인하십시오.");
    } finally {
      el.chatSend.disabled = false;
      el.chatInput.focus();
    }
  }

  el.chatForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    sendChat();
  });
  el.chatInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      sendChat();
    }
  });
  el.chatReset.addEventListener("click", async () => {
    if (chatSessionId) {
      await fetch("/api/chat/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: chatSessionId }),
      }).catch(() => undefined);
    }
    chatSessionId = null;
    el.chatLog.replaceChildren();
  });

  loadStatus();
})();
