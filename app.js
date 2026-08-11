/**
 * 생활기록부 피드백 & 학생 수정 제출 시스템 (범용 버전)
 * 다학급 / 다교과 독립형 구글 스프레드시트 연동 시스템
 */

document.addEventListener('DOMContentLoaded', () => {
  const DOMAIN_LIMITS = {
    autonomy: 1500,
    career: 1500,
    korean: 1500,
    individual: 1500
  };

  const DOMAINS = ['autonomy', 'career', 'korean', 'individual'];
  const REQUIRED_DOMAINS = ['autonomy', 'career', 'korean'];
  const OPTIONAL_DOMAINS = ['individual'];

  const CONFIG_STORAGE_KEY = 'school_universal_config_v1';
  const DB_STORAGE_KEY_PREFIX = 'school_universal_db_';

  // Config State
  let config = {
    sheetUrl: '',
    className: '우리 반',
    teacherPassword: 'teacher1234'
  };

  // Student Roster (구글 시트에서 동적으로 파싱됨)
  let studentRoster = {};

  // Database State
  let db = {
    students: {},
    teacherPassword: 'teacher1234'
  };

  let currentUser = null; // null | { role: 'student', id: '...', name: '...' } | { role: 'teacher' }
  let selectedStudentIdForTeacher = null;

  // DOM Elements
  const elHeaderClassTitle = document.getElementById('header-class-title');
  const elHeaderClassBadge = document.getElementById('header-class-badge');
  const elLoginClassTitle = document.getElementById('login-class-title');
  const elNoSheetBanner = document.getElementById('no-sheet-banner');
  const elActiveSheetBanner = document.getElementById('active-sheet-banner');
  const elActiveSheetName = document.getElementById('active-sheet-name');

  const elStudentIdInput = document.getElementById('student-id');
  const elStudentNamePreview = document.getElementById('student-name-preview');
  const elPreviewNameText = document.getElementById('preview-name-text');

  const elUserProfile = document.getElementById('user-profile');
  const elUserRoleTag = document.getElementById('user-role-tag');
  const elUserDisplayName = document.getElementById('user-display-name');

  const elLoginSection = document.getElementById('login-section');
  const elStudentSection = document.getElementById('student-section');
  const elTeacherSection = document.getElementById('teacher-section');

  // Config Modal Elements
  const configModal = document.getElementById('config-modal');
  const cfgClassNameInput = document.getElementById('cfg-class-name');
  const cfgSheetUrlInput = document.getElementById('cfg-sheet-url');
  const cfgTeacherPwInput = document.getElementById('cfg-teacher-pw');
  const cfgShareLinkInput = document.getElementById('cfg-share-link');
  const btnCopyShareLink = document.getElementById('btn-copy-share-link');

  // --------------------------------------------------------------------------
  // 1. CONFIG & URL PARAMETERS INITIALIZATION
  // --------------------------------------------------------------------------
  function initConfig() {
    // 1순위: URL 파라미터 확인 (?sheet=...&class=...)
    const urlParams = new URLSearchParams(window.location.search);
    const paramSheet = urlParams.get('sheet');
    const paramClass = urlParams.get('class');

    // 2순위: 로컬 스토리지 확인
    const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (savedConfig) {
      try {
        config = { ...config, ...JSON.parse(savedConfig) };
      } catch (e) {
        console.error('Config parse error', e);
      }
    }

    if (paramSheet) {
      config.sheetUrl = decodeURIComponent(paramSheet);
    }
    if (paramClass) {
      config.className = decodeURIComponent(paramClass);
    }

    updateConfigUI();
    initDatabase();
  }

  function updateConfigUI() {
    if (config.className) {
      elHeaderClassTitle.textContent = `${config.className} 생활기록부 피드백 시스템`;
      elHeaderClassBadge.textContent = config.className;
      elLoginClassTitle.textContent = `${config.className} 포털 로그인`;
      elActiveSheetName.textContent = config.className;
    }

    if (config.sheetUrl) {
      elNoSheetBanner.classList.add('hidden');
      elActiveSheetBanner.classList.remove('hidden');
    } else {
      elNoSheetBanner.classList.remove('hidden');
      elActiveSheetBanner.classList.add('hidden');
    }

    // Modal Inputs
    cfgClassNameInput.value = config.className || '';
    cfgSheetUrlInput.value = config.sheetUrl || '';
    cfgTeacherPwInput.value = config.teacherPassword || 'teacher1234';

    updateShareLinkDisplay();
  }

  function updateShareLinkDisplay() {
    if (config.sheetUrl) {
      const baseUrl = window.location.origin + window.location.pathname;
      const shareUrl = `${baseUrl}?sheet=${encodeURIComponent(config.sheetUrl)}&class=${encodeURIComponent(config.className || '우리반')}`;
      cfgShareLinkInput.value = shareUrl;
    } else {
      cfgShareLinkInput.value = '구글 시트 URL 설정 저장 후 생성됩니다.';
    }
  }

  // --------------------------------------------------------------------------
  // 2. DATABASE & GOOGLE SHEET SYNC
  // --------------------------------------------------------------------------
  function getDbStorageKey() {
    return DB_STORAGE_KEY_PREFIX + (config.className || 'default');
  }

  function initDatabase() {
    const key = getDbStorageKey();
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        db = JSON.parse(saved);
      } catch (e) {
        db = { students: {}, teacherPassword: config.teacherPassword || 'teacher1234' };
      }
    } else {
      db = { students: {}, teacherPassword: config.teacherPassword || 'teacher1234' };
    }

    if (config.sheetUrl) {
      syncFromGoogleSheet();
    }
  }

  function saveDatabase() {
    const key = getDbStorageKey();
    localStorage.setItem(key, JSON.stringify(db));
  }

  function createDefaultStudentObject(id, name) {
    return {
      id,
      name,
      password: id,
      isFirstLogin: true,
      status: 'unwritten',
      updatedAt: null,
      careerHope: '',
      submissions: {
        autonomy: '',
        career: '',
        korean: '',
        individual: ''
      },
      feedbacks: {
        autonomy: { text: '', date: '' },
        career: { text: '', date: '' },
        korean: { text: '', date: '' },
        individual: { text: '', date: '' }
      }
    };
  }

  // Google Sheet API - 실시간 불러오기
  async function syncFromGoogleSheet() {
    if (!config.sheetUrl) return;
    try {
      const res = await fetch(config.sheetUrl);
      if (res.ok) {
        const sheetDataList = await res.json();
        if (Array.isArray(sheetDataList)) {
          studentRoster = {};

          sheetDataList.forEach(item => {
            const id = String(item.id).trim();
            const name = String(item.name || '').trim();
            if (!id) return;

            studentRoster[id] = name || `${id} 학생`;

            if (!db.students[id]) {
              db.students[id] = createDefaultStudentObject(id, studentRoster[id]);
            } else {
              db.students[id].name = studentRoster[id];
            }

            const student = db.students[id];
            if (item.careerHope !== undefined) student.careerHope = String(item.careerHope || '');

            // Feedbacks
            if (item.feedbacks) {
              DOMAINS.forEach(d => {
                if (item.feedbacks[d] && item.feedbacks[d].text !== undefined) {
                  student.feedbacks[d].text = String(item.feedbacks[d].text);
                  if (student.feedbacks[d].text.trim()) {
                    student.feedbacks[d].date = student.feedbacks[d].date || new Date().toLocaleDateString('ko-KR');
                  }
                }
              });
            }

            // Submissions
            if (item.submissions) {
              let hasSubmission = false;
              DOMAINS.forEach(d => {
                if (item.submissions[d] !== undefined) {
                  student.submissions[d] = String(item.submissions[d]);
                  if (String(item.submissions[d]).trim()) {
                    hasSubmission = true;
                  }
                }
              });
              if (hasSubmission) {
                student.status = 'submitted';
                student.updatedAt = student.updatedAt || new Date().toLocaleString();
              }
            }
          });

          saveDatabase();
          if (currentUser?.role === 'teacher') {
            renderTeacherDashboard();
          }
        }
      }
    } catch (e) {
      console.warn('Google Sheet Sync Warning:', e);
    }
  }

  // Google Sheet API - 실시간 전송하기
  async function sendToGoogleSheet(student) {
    if (!config.sheetUrl || !student) return;
    try {
      const payload = {
        id: student.id,
        name: student.name,
        careerHope: student.careerHope || '',
        submissions: student.submissions || {},
        feedbacks: {
          autonomy: student.feedbacks.autonomy?.text || '',
          career: student.feedbacks.career?.text || '',
          korean: student.feedbacks.korean?.text || '',
          individual: student.feedbacks.individual?.text || ''
        }
      };

      await fetch(config.sheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Google Sheet Send Error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 3. STATS & PROGRESS CALCULATION (필수 3/3 기준)
  // --------------------------------------------------------------------------
  function getStudentSubmissionStats(student) {
    if (!student) {
      return { requiredCount: 0, totalCount: 0, details: {}, statusCategory: 'unwritten', hasOptional: false };
    }

    let requiredCount = 0;
    let totalCount = 0;
    const details = {
      autonomy: false,
      career: false,
      korean: false,
      individual: false
    };

    DOMAINS.forEach(d => {
      const val = student.submissions?.[d];
      if (val && String(val).trim()) {
        details[d] = true;
        totalCount++;
        if (REQUIRED_DOMAINS.includes(d)) {
          requiredCount++;
        }
      }
    });

    let statusCategory = 'unwritten';
    if (requiredCount === 3) {
      statusCategory = 'all_submitted';
    } else if (requiredCount > 0 || details.individual) {
      statusCategory = 'partial';
    }

    return { 
      requiredCount, 
      totalCount, 
      details, 
      statusCategory, 
      hasOptional: details.individual 
    };
  }

  // --------------------------------------------------------------------------
  // 4. NEIS BYTE LENGTH CALCULATION
  // --------------------------------------------------------------------------
  function getNeisByteLength(str) {
    if (!str) return 0;
    let bytes = 0;
    const cleanStr = str.replace(/\r\n/g, '\n');
    for (let i = 0; i < cleanStr.length; i++) {
      const code = cleanStr.charCodeAt(i);
      if (cleanStr[i] === '\n') {
        bytes += 2;
      } else if (code <= 0x007f) {
        bytes += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  // --------------------------------------------------------------------------
  // 5. AUTH & LOGIN LOGIC
  // --------------------------------------------------------------------------
  // Login Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab + '-form').classList.add('active');
    });
  });

  // Student ID Name Preview
  elStudentIdInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (studentRoster[val]) {
      elPreviewNameText.textContent = studentRoster[val];
      elStudentNamePreview.classList.remove('hidden');
    } else if (db.students[val]) {
      elPreviewNameText.textContent = db.students[val].name;
      elStudentNamePreview.classList.remove('hidden');
    } else {
      elStudentNamePreview.classList.add('hidden');
    }
  });

  // Student Login Submit
  document.getElementById('student-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = elStudentIdInput.value.trim();
    const pw = document.getElementById('student-pw').value;

    if (!db.students[id]) {
      // 자동 등록 시도
      if (studentRoster[id]) {
        db.students[id] = createDefaultStudentObject(id, studentRoster[id]);
      } else {
        showToast('등록되지 않은 학번입니다. 학급 시트 연동을 확인해 주세요.', 'error');
        return;
      }
    }

    const student = db.students[id];
    if (student.password !== pw) {
      showToast('비밀번호가 일치하지 않습니다.', 'error');
      return;
    }

    currentUser = { role: 'student', id: id, name: student.name };
    showToast(`${student.name} 학생, 환영합니다!`, 'success');
    renderHeader();

    syncFromGoogleSheet().then(() => {
      renderStudentWorkspace();
    });
    renderStudentWorkspace();

    if (student.password === id || student.isFirstLogin) {
      openPwModal(true);
    }
  });

  // Teacher Login Submit
  document.getElementById('teacher-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('teacher-pw').value;
    const targetPw = config.teacherPassword || db.teacherPassword || 'teacher1234';

    if (pw !== targetPw) {
      showToast('선생님 비밀번호가 올바르지 않습니다.', 'error');
      return;
    }

    currentUser = { role: 'teacher' };
    showToast('교사 관리자 모드로 접속했습니다. 구글 시트 동기화 중...', 'info');
    renderHeader();
    renderTeacherDashboard();

    await syncFromGoogleSheet();
    renderTeacherDashboard();
    showToast('구글 시트 최신 제출물이 동기화되었습니다!', 'success');
  });

  // Logout Handler
  document.getElementById('btn-logout').addEventListener('click', () => {
    currentUser = null;
    renderHeader();
    showToast('로그아웃되었습니다.', 'success');
  });

  function renderHeader() {
    if (!currentUser) {
      elUserProfile.classList.add('hidden');
      elLoginSection.classList.remove('hidden');
      elStudentSection.classList.add('hidden');
      elTeacherSection.classList.add('hidden');
      document.getElementById('student-pw').value = '';
    } else {
      elUserProfile.classList.remove('hidden');
      elLoginSection.classList.add('hidden');

      if (currentUser.role === 'student') {
        elUserRoleTag.textContent = '학생';
        elUserRoleTag.classList.remove('teacher');
        elUserDisplayName.textContent = `${currentUser.id} ${currentUser.name}`;
        elStudentSection.classList.remove('hidden');
        elTeacherSection.classList.add('hidden');
      } else {
        elUserRoleTag.textContent = '선생님';
        elUserRoleTag.classList.add('teacher');
        elUserDisplayName.textContent = `${config.className || '학급'} 담당교사`;
        elStudentSection.classList.add('hidden');
        elTeacherSection.classList.remove('hidden');
      }
    }
  }

  // --------------------------------------------------------------------------
  // 6. STUDENT WORKSPACE LOGIC
  // --------------------------------------------------------------------------
  function formatFeedbackText(text) {
    if (!text) return '등록된 피드백이 없습니다.';
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(/\((.*?)\)/g, '<span class="feedback-highlight">($1)</span>');
  }

  function renderStudentWorkspace() {
    const student = db.students[currentUser.id];
    document.getElementById('student-welcome-title').textContent = `${student.id} ${student.name} 학생의 생활기록부 워크스페이스`;
    updateSubmitStatusBadge(student);

    document.getElementById('input-career-hope').value = student.careerHope || '';

    DOMAINS.forEach(domain => {
      const fb = student.feedbacks[domain];
      const fbEl = document.getElementById(`feedback-${domain}`);
      const fbDateEl = document.getElementById(`date-${domain}`);

      if (fb && fb.text) {
        fbEl.innerHTML = formatFeedbackText(fb.text);
        fbDateEl.textContent = fb.date || '';
      } else {
        fbEl.innerHTML = '등록된 피드백이 없습니다.';
        fbDateEl.textContent = '-';
      }

      const inputEl = document.getElementById(`input-${domain}`);
      inputEl.value = student.submissions[domain] || '';

      updateByteCount(domain);
    });
  }

  function updateSubmitStatusBadge(studentOrStatus) {
    const badge = document.getElementById('submit-status-badge');
    const student = (typeof studentOrStatus === 'object' && studentOrStatus) 
      ? studentOrStatus 
      : (currentUser?.id ? db.students[currentUser.id] : null);
    
    if (student) {
      const stats = getStudentSubmissionStats(student);
      if (stats.requiredCount === 3) {
        badge.textContent = `✅ 전체 완료 (필수 3/3 제출됨${stats.hasOptional ? ' + 개인세특 포함' : ''})`;
        badge.className = 'badge badge-success';
      } else if (stats.requiredCount > 0 || stats.hasOptional) {
        badge.textContent = `✍️ 부분 작성 (필수 ${stats.requiredCount}/3${stats.hasOptional ? ' + 개인세특' : ''})`;
        badge.className = 'badge badge-partial';
      } else {
        badge.textContent = '⏳ 미작성 (0/3 영역)';
        badge.className = 'badge badge-secondary';
      }
    }
  }

  // Real-time Byte Counting for Inputs
  DOMAINS.forEach(domain => {
    const textarea = document.getElementById(`input-${domain}`);
    textarea.addEventListener('input', () => {
      updateByteCount(domain);
      autoSaveStudentData();
    });
  });

  document.getElementById('input-career-hope').addEventListener('input', () => {
    updateByteCount('career');
    autoSaveStudentData();
  });

  function updateByteCount(domain) {
    const bodyVal = document.getElementById(`input-${domain}`).value;
    let measuredText = bodyVal;
    let chars = bodyVal.length;

    if (domain === 'career') {
      const careerHope = document.getElementById('input-career-hope').value.trim();
      measuredText = (careerHope ? careerHope + '\n' : '') + bodyVal;
      chars = (careerHope ? careerHope.length + 1 : 0) + bodyVal.length;
    }

    const bytes = getNeisByteLength(measuredText);
    const maxBytes = DOMAIN_LIMITS[domain];

    const counterEl = document.getElementById(`byte-${domain}`);
    const progressEl = document.getElementById(`progress-${domain}`);

    counterEl.textContent = `${bytes} / ${maxBytes} Bytes (${chars}자)`;
    const percent = Math.min((bytes / maxBytes) * 100, 100);
    progressEl.style.width = `${percent}%`;

    counterEl.classList.remove('warn', 'danger');
    progressEl.classList.remove('warn', 'danger');

    if (bytes > maxBytes) {
      counterEl.classList.add('danger');
      progressEl.classList.add('danger');
    } else if (bytes >= maxBytes * 0.9) {
      counterEl.classList.add('warn');
      progressEl.classList.add('warn');
    }
  }

  // Teacher Feedback Copy & Apply
  document.querySelectorAll('.btn-copy-fb').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser || currentUser.role !== 'student') return;
      const domain = btn.dataset.domain;
      const student = db.students[currentUser.id];
      const fbText = student?.feedbacks[domain]?.text;
      if (!fbText) {
        showToast('복사할 피드백이 없습니다.', 'error');
        return;
      }
      navigator.clipboard.writeText(fbText).then(() => {
        showToast('선생님 피드백이 클립보드에 복사되었습니다!', 'success');
      });
    });
  });

  document.querySelectorAll('.btn-apply-fb').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentUser || currentUser.role !== 'student') return;
      const domain = btn.dataset.domain;
      const student = db.students[currentUser.id];
      const fbText = student?.feedbacks[domain]?.text;
      if (!fbText) {
        showToast('적용할 피드백 내용이 없습니다.', 'error');
        return;
      }

      const cleanBodyText = fbText.replace(/\((.*?)\)/g, '').replace(/[ \t]+\n/g, '\n').trim();
      const textarea = document.getElementById(`input-${domain}`);
      textarea.value = cleanBodyText;

      updateByteCount(domain);
      autoSaveStudentData();

      if (fbText.includes('(') && fbText.includes(')')) {
        showToast('✨ 소괄호 지침을 뺀 피드백 본문이 작성란에 적용되었습니다.', 'success');
      } else {
        showToast('✨ 선생님 피드백 그대로 적용되었습니다. 상단의 [🚀 최종 제출하기]를 누르시면 완료됩니다!', 'success');
      }
    });
  });

  // Auto Save Debouncer
  let autoSaveTimeout = null;
  function autoSaveStudentData() {
    if (!currentUser || currentUser.role !== 'student') return;

    const autoSaveIndicator = document.getElementById('auto-save-indicator');
    autoSaveIndicator.textContent = '⏳ 저장 중...';

    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
      const student = db.students[currentUser.id];
      student.careerHope = document.getElementById('input-career-hope').value.trim();

      let hasContent = false;
      DOMAINS.forEach(domain => {
        const val = document.getElementById(`input-${domain}`).value;
        student.submissions[domain] = val;
        if (val.trim()) hasContent = true;
      });

      if (student.status !== 'submitted') {
        student.status = hasContent ? 'writing' : 'unwritten';
      }

      student.updatedAt = new Date().toLocaleString();
      saveDatabase();
      updateSubmitStatusBadge(student);
      
      sendToGoogleSheet(student);
      autoSaveIndicator.textContent = '🔄 자동 저장됨 (구글 시트 연동완료)';
    }, 800);
  }

  // Temporary Save Button
  document.getElementById('btn-temp-save').addEventListener('click', () => {
    autoSaveStudentData();
    showToast('임시 저장 및 구글 시트에 연동되었습니다.', 'success');
  });

  // Final Submit Button
  document.getElementById('btn-final-submit').addEventListener('click', () => {
    if (!confirm('작성하신 내용을 최종 제출하시겠습니까?\n제출 후에도 언제든지 수정하실 수 있습니다.')) return;

    const student = db.students[currentUser.id];
    student.careerHope = document.getElementById('input-career-hope').value.trim();
    DOMAINS.forEach(domain => {
      student.submissions[domain] = document.getElementById(`input-${domain}`).value;
    });

    student.status = 'submitted';
    student.updatedAt = new Date().toLocaleString();
    saveDatabase();

    sendToGoogleSheet(student);
    updateSubmitStatusBadge(student);
    showToast('선생님 구글 엑셀 시트로 성공적으로 최종 제출되었습니다!', 'success');
  });

  // Copy to Clipboard Buttons
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const targetInput = document.getElementById(targetId);
      if (!targetInput || !targetInput.value) {
        showToast('복사할 내용이 없습니다.', 'error');
        return;
      }
      navigator.clipboard.writeText(targetInput.value).then(() => {
        showToast('클립보드에 복사되었습니다!', 'success');
      });
    });
  });

  // --------------------------------------------------------------------------
  // 7. TEACHER DASHBOARD LOGIC
  // --------------------------------------------------------------------------
  function renderTeacherDashboard() {
    const students = Object.values(db.students).sort((a, b) => a.id.localeCompare(b.id));

    let allSubmittedCount = 0;
    let partialCount = 0;
    let unwrittenCount = 0;

    students.forEach(s => {
      const stats = getStudentSubmissionStats(s);
      if (stats.requiredCount === 3) {
        allSubmittedCount++;
      } else if (stats.requiredCount > 0 || stats.hasOptional) {
        partialCount++;
      } else {
        unwrittenCount++;
      }
    });

    document.getElementById('stat-total-count').textContent = `${students.length}명`;
    document.getElementById('stat-all-submitted-count').textContent = `${allSubmittedCount}명`;
    document.getElementById('stat-partial-count').textContent = `${partialCount}명`;
    document.getElementById('stat-unwritten-count').textContent = `${unwrittenCount}명`;

    renderStudentGrid();
  }

  function renderStudentGrid() {
    const grid = document.getElementById('student-grid');
    grid.innerHTML = '';

    const searchText = document.getElementById('student-search-input').value.toLowerCase().trim();
    const filterStatus = document.getElementById('student-status-filter').value;

    const students = Object.values(db.students).sort((a, b) => a.id.localeCompare(b.id));

    if (students.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">등록된 학생이 없습니다. 상단 [⚙️ 학급/과목 시트 설정]에서 시트를 연결해 주세요.</div>';
      return;
    }

    students.forEach(student => {
      const stats = getStudentSubmissionStats(student);

      if (filterStatus !== 'all' && stats.statusCategory !== filterStatus) return;
      if (searchText && !student.id.includes(searchText) && !student.name.toLowerCase().includes(searchText)) return;

      const card = document.createElement('div');
      card.className = 'student-card';

      let statusBadgeClass = 'badge-secondary';
      let statusText = '미작성 (0/3)';
      if (stats.requiredCount === 3) {
        statusBadgeClass = 'badge-success';
        statusText = '전체 완료 (3/3)';
      } else if (stats.requiredCount > 0 || stats.hasOptional) {
        statusBadgeClass = 'badge-partial';
        statusText = `부분 제출 (${stats.requiredCount}/3)`;
      }

      card.innerHTML = `
        <div class="student-card-header">
          <span class="student-id-text">${student.id}</span>
          <span class="badge ${statusBadgeClass}">${statusText}</span>
        </div>
        <div class="student-name">${student.name}</div>
        <div class="domain-mini-grid">
          <div class="domain-mini-badge ${stats.details.autonomy ? 'done' : ''}">자율 ${stats.details.autonomy ? '✅' : '⏳'}</div>
          <div class="domain-mini-badge ${stats.details.career ? 'done' : ''}">진로 ${stats.details.career ? '✅' : '⏳'}</div>
          <div class="domain-mini-badge ${stats.details.korean ? 'done' : ''}">국어 ${stats.details.korean ? '✅' : '⏳'}</div>
          <div class="domain-mini-badge optional ${stats.details.individual ? 'done' : ''}">개인(선택) ${stats.details.individual ? '✅' : '➖'}</div>
        </div>
        <div class="student-card-footer">
          <span>최종 수정: ${student.updatedAt || '기록 없음'}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        openTeacherEditModal(student.id);
      });

      grid.appendChild(card);
    });
  }

  document.getElementById('student-search-input').addEventListener('input', renderStudentGrid);
  document.getElementById('student-status-filter').addEventListener('change', renderStudentGrid);

  // Sync Sheet Button (Teacher Dashboard)
  document.getElementById('btn-sync-sheet')?.addEventListener('click', async () => {
    showToast('구글 시트에서 최신 학생 제출물을 불러오는 중입니다...', 'info');
    await syncFromGoogleSheet();
    renderTeacherDashboard();
    showToast('구글 시트 최신 제출물이 성공적으로 동기화되었습니다!', 'success');
  });

  // Open Teacher Edit Modal
  function openTeacherEditModal(studentId) {
    selectedStudentIdForTeacher = studentId;
    const student = db.students[studentId];
    const stats = getStudentSubmissionStats(student);

    document.getElementById('teacher-modal-student-info').textContent = `${student.id} ${student.name} 학생 피드백 관리`;

    const badge = document.getElementById('teacher-modal-status-badge');
    if (stats.requiredCount === 3) {
      badge.textContent = `전체 제출 완료 (필수 3/3${stats.hasOptional ? ' + 개인세특' : ''})`;
      badge.className = 'badge badge-success';
    } else if (stats.requiredCount > 0 || stats.hasOptional) {
      badge.textContent = `부분 제출 (필수 ${stats.requiredCount}/3${stats.hasOptional ? ' + 개인세특' : ''})`;
      badge.className = 'badge badge-partial';
    } else {
      badge.textContent = '미작성 (0/3 영역)';
      badge.className = 'badge badge-secondary';
    }

    document.getElementById('t-career-hope-view').value = student.careerHope || '(미작성)';

    DOMAINS.forEach(domain => {
      document.getElementById(`t-feedback-${domain}`).value = student.feedbacks[domain]?.text || '';
      document.getElementById(`t-submission-${domain}`).textContent = student.submissions[domain] || '(학생이 작성한 수정본이 없습니다.)';
    });

    document.getElementById('teacher-edit-modal').classList.remove('hidden');
  }

  // Teacher Edit Tabs
  document.querySelectorAll('.t-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.t-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.teacher-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.ttab).classList.add('active');
    });
  });

  // Save Teacher Feedback Button
  document.getElementById('btn-save-teacher-feedback').addEventListener('click', () => {
    if (!selectedStudentIdForTeacher) return;
    const student = db.students[selectedStudentIdForTeacher];
    const todayStr = new Date().toLocaleDateString('ko-KR');

    DOMAINS.forEach(domain => {
      const fbText = document.getElementById(`t-feedback-${domain}`).value.trim();
      student.feedbacks[domain] = {
        text: fbText,
        date: fbText ? todayStr : ''
      };
    });

    saveDatabase();
    sendToGoogleSheet(student);
    showToast(`${student.name} 학생 피드백이 저장되고 시트에 연동되었습니다.`, 'success');
    document.getElementById('teacher-edit-modal').classList.add('hidden');
    renderTeacherDashboard();
  });

  // Reset Student Password Button
  document.getElementById('btn-reset-student-pw').addEventListener('click', () => {
    if (!selectedStudentIdForTeacher) return;
    const student = db.students[selectedStudentIdForTeacher];
    if (confirm(`${student.name} 학생의 비밀번호를 초기값(${student.id})으로 리셋하시겠습니까?`)) {
      student.password = student.id;
      student.isFirstLogin = true;
      saveDatabase();
      showToast(`${student.name} 학생의 비밀번호가 ${student.id}로 초기화되었습니다.`, 'success');
    }
  });

  // Export All to CSV
  document.getElementById('btn-export-all').addEventListener('click', () => {
    const students = Object.values(db.students).sort((a, b) => a.id.localeCompare(b.id));
    let csvContent = "\uFEFF학번,이름,제출상태,진로희망분야,자율활동_수정본,진로활동_수정본,국어세특_수정본,개인세특_수정본\n";

    students.forEach(s => {
      const row = [
        s.id,
        s.name,
        s.status,
        `"${(s.careerHope || '').replace(/"/g, '""')}"`,
        `"${(s.submissions.autonomy || '').replace(/"/g, '""')}"`,
        `"${(s.submissions.career || '').replace(/"/g, '""')}"`,
        `"${(s.submissions.korean || '').replace(/"/g, '""')}"`,
        `"${(s.submissions.individual || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${config.className || '생기부'}_제출현황_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    showToast('전체 CSV 파일이 다운로드되었습니다.', 'success');
  });

  // Export TXT
  document.getElementById('btn-export-txt').addEventListener('click', () => {
    const students = Object.values(db.students).sort((a, b) => a.id.localeCompare(b.id));
    let txtContent = `====================================================\n`;
    txtContent += ` [${config.className || '학급'}] 학생 생활기록부 수정본 통합 문서\n`;
    txtContent += ` 생성일시: ${new Date().toLocaleString()}\n`;
    txtContent += `====================================================\n\n`;

    students.forEach(s => {
      txtContent += `▶ 학번/이름: ${s.id} ${s.name}\n`;
      txtContent += `▶ 진로희망분야: ${s.careerHope || '(미작성)'}\n`;
      txtContent += `----------------------------------------------------\n`;
      txtContent += `[1. 자율활동]\n${s.submissions.autonomy || '(미제출)'}\n\n`;
      txtContent += `[2. 진로활동]\n${s.submissions.career || '(미제출)'}\n\n`;
      txtContent += `[3. 국어 세특]\n${s.submissions.korean || '(미제출)'}\n\n`;
      txtContent += `[4. 개인 세특 (선택)]\n${s.submissions.individual || '(미제출)'}\n`;
      txtContent += `====================================================\n\n`;
    });

    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${config.className || '생기부'}_통합제출문서_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    showToast('TXT 통합 문서가 다운로드되었습니다.', 'success');
  });

  // --------------------------------------------------------------------------
  // 8. CONFIG MODAL LOGIC (학급 시트 연동)
  // --------------------------------------------------------------------------
  document.getElementById('btn-open-config-modal').addEventListener('click', () => {
    configModal.classList.remove('hidden');
    updateConfigUI();
  });

  document.getElementById('btn-save-config').addEventListener('click', async () => {
    const newClass = cfgClassNameInput.value.trim() || '우리 반';
    const newSheet = cfgSheetUrlInput.value.trim();
    const newPw = cfgTeacherPwInput.value.trim() || 'teacher1234';

    config.className = newClass;
    config.sheetUrl = newSheet;
    config.teacherPassword = newPw;

    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));

    updateConfigUI();
    configModal.classList.add('hidden');
    showToast('학급 설정이 저장되었습니다. 구글 시트 동기화를 진행합니다...', 'info');

    if (config.sheetUrl) {
      await syncFromGoogleSheet();
      showToast('구글 시트 연동 완료!', 'success');
    }
  });

  btnCopyShareLink.addEventListener('click', () => {
    if (!config.sheetUrl) {
      showToast('먼저 구글 시트 URL을 입력하고 저장해 주세요.', 'error');
      return;
    }
    navigator.clipboard.writeText(cfgShareLinkInput.value).then(() => {
      showToast('우리 반 학생 전용 접속 링크가 복사되었습니다! 학급 단톡/클래스룸에 공유하세요.', 'success');
    });
  });

  // --------------------------------------------------------------------------
  // 9. PASSWORD CHANGE MODAL
  // --------------------------------------------------------------------------
  function openPwModal(isInitial = false) {
    document.getElementById('new-pw').value = '';
    document.getElementById('new-pw-confirm').value = '';
    document.getElementById('pw-change-modal').classList.remove('hidden');
  }

  document.getElementById('btn-save-pw').addEventListener('click', () => {
    const newPw = document.getElementById('new-pw').value;
    const confirmPw = document.getElementById('new-pw-confirm').value;

    if (!newPw || newPw.length < 4) {
      showToast('비밀번호는 최소 4자 이상 입력해주세요.', 'error');
      return;
    }
    if (newPw !== confirmPw) {
      showToast('비밀번호 확인이 일치하지 않습니다.', 'error');
      return;
    }

    if (currentUser?.role === 'student') {
      const student = db.students[currentUser.id];
      student.password = newPw;
      student.isFirstLogin = false;
      saveDatabase();
      document.getElementById('pw-change-modal').classList.add('hidden');
      showToast('비밀번호가 안전하게 변경되었습니다!', 'success');
    }
  });

  // --------------------------------------------------------------------------
  // 10. BATCH FEEDBACK MODAL
  // --------------------------------------------------------------------------
  const batchModal = document.getElementById('batch-modal');
  const batchTextInput = document.getElementById('batch-text-input');
  const batchFileInput = document.getElementById('batch-file-input');
  const batchDomainSelect = document.getElementById('batch-domain-select');
  const batchParsedCount = document.getElementById('batch-parsed-count');
  const batchPreviewTbody = document.getElementById('batch-preview-tbody');
  let parsedBatchMap = {};

  document.getElementById('btn-open-batch-modal').addEventListener('click', () => {
    batchModal.classList.remove('hidden');
    parsedBatchMap = {};
    batchTextInput.value = '';
    batchFileInput.value = '';
    renderBatchPreview();
  });

  document.querySelectorAll('.batch-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.batch-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.batch-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.btab).classList.add('active');
    });
  });

  batchTextInput.addEventListener('input', () => {
    parseBatchText(batchTextInput.value);
  });

  batchFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      parseBatchCSV(event.target.result);
    };
    reader.readAsText(file, 'UTF-8');
  });

  function parseBatchText(rawText) {
    parsedBatchMap = {};
    if (!rawText.trim()) {
      renderBatchPreview();
      return;
    }

    const lines = rawText.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const match = trimmed.match(/^(\d{4,6})[\s\t,:\-]+(.*)$/);
      if (match) {
        const id = match[1];
        let content = match[2].trim();
        const name = studentRoster[id] || db.students[id]?.name;
        content = cleanFeedbackText(content, name);
        parsedBatchMap[id] = content;
      }
    });

    renderBatchPreview();
  }

  function parseBatchCSV(csvText) {
    parsedBatchMap = {};
    if (!csvText.trim()) {
      renderBatchPreview();
      return;
    }

    const lines = csvText.split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const parts = trimmed.split(',');
      if (parts.length >= 2) {
        const rawId = parts[0].replace(/["']/g, '').trim();
        const idMatch = rawId.match(/\d{4,6}/);
        if (idMatch) {
          const id = idMatch[0];
          const name = studentRoster[id] || db.students[id]?.name;
          let fbText = parts.slice(parts.length > 2 ? 2 : 1).join(',').replace(/^["']|["']$/g, '').trim();
          fbText = cleanFeedbackText(fbText, name);
          parsedBatchMap[id] = fbText;
        }
      }
    });
    renderBatchPreview();
  }

  function cleanFeedbackText(str, name) {
    if (!str) return '';
    let cleaned = str.trim();
    if (name && cleaned.startsWith(name)) {
      cleaned = cleaned.substring(name.length).trim();
    }
    cleaned = cleaned.replace(/^[:,\t\s\-–—]+/, '').trim();
    return cleaned;
  }

  function renderBatchPreview() {
    batchPreviewTbody.innerHTML = '';
    const rosterIds = Object.keys(studentRoster).length ? Object.keys(studentRoster).sort() : Object.keys(db.students).sort();
    let count = 0;

    rosterIds.forEach(id => {
      const name = studentRoster[id] || db.students[id]?.name || `${id} 학생`;
      const fb = parsedBatchMap[id] || '';
      if (fb) count++;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${id}</strong></td>
        <td>${name}</td>
        <td class="${fb ? '' : 'empty-fb'}">${fb ? fb : '(입력 대기중)'}</td>
      `;
      batchPreviewTbody.appendChild(tr);
    });

    batchParsedCount.textContent = count;
  }

  document.getElementById('btn-apply-batch').addEventListener('click', () => {
    const domain = batchDomainSelect.value;
    const domainName = batchDomainSelect.options[batchDomainSelect.selectedIndex].text;
    const count = Object.keys(parsedBatchMap).length;

    if (count === 0) {
      showToast('적용할 피드백 데이터가 없습니다.', 'error');
      return;
    }

    if (!confirm(`[${domainName}] 영역에 ${count}명의 피드백을 일괄 적용하시겠습니까?`)) return;

    const todayStr = new Date().toLocaleDateString('ko-KR');
    Object.keys(parsedBatchMap).forEach(id => {
      if (!db.students[id]) {
        db.students[id] = createDefaultStudentObject(id, studentRoster[id] || `${id} 학생`);
      }
      db.students[id].feedbacks[domain] = {
        text: parsedBatchMap[id],
        date: todayStr
      };
      sendToGoogleSheet(db.students[id]);
    });

    saveDatabase();
    showToast(`${count}명의 [${domainName}] 피드백이 저장 및 시트에 연동되었습니다!`, 'success');
    batchModal.classList.add('hidden');
    renderTeacherDashboard();
  });

  // Download CSV Template
  document.getElementById('btn-download-csv-template').addEventListener('click', () => {
    const rosterIds = Object.keys(studentRoster).length ? Object.keys(studentRoster).sort() : Object.keys(db.students).sort();
    let csvContent = "\uFEFF학번,이름,피드백내용\n";

    rosterIds.forEach(id => {
      const name = studentRoster[id] || db.students[id]?.name || `${id} 학생`;
      csvContent += `${id},${name},""\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${config.className || '학급'}_피드백_입력양식.csv`;
    link.click();
  });

  // Close Modals
  document.querySelectorAll('.modal-close-btn, .modal-close-action').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    });
  });

  // --------------------------------------------------------------------------
  // 11. TOAST NOTIFICATIONS
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3200);
  }

  // Start App
  initConfig();
  renderHeader();
});
