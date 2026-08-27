(function installFormalWorkstationAdapter(window) {
  "use strict";

  if (window.location.protocol === "file:") return;
  try {
    if (new URLSearchParams(window.location.search).get("formal") !== "1") return;
  } catch (error) {
    void error;
    return;
  }

  var bootstrap = null;
  var projectCreateAttempt = null;
  var taskCreateAttempt = null;
  var taskBatchAttempt = null;
  var taskTransitionAttempts = Object.create(null);
  var runtime = { authMode: "feishu", dataMode: "server" };
  var embeddedBootstrap = window.__QUANTXY_SERVER_BOOTSTRAP__ || null;
  var bootstrapErrorCodes = {
    workstation_bootstrap_failed: true,
    workstation_unavailable: true,
  };
  var domainErrorCodes = {
    activation_example_mismatch: true,
    agent_context_unavailable: true,
    confirmed_payroll_immutable: true,
    conflict: true,
    command_failed: true,
    directory_actor_invalid: true,
    directory_sync_failed: true,
    employee_hire_date_missing: true,
    employee_not_found: true,
    employee_profile_not_found: true,
    forbidden: true,
    invalid_base_range: true,
    invalid_business_date: true,
    invalid_money: true,
    invalid_month: true,
    invalid_rate: true,
    invalid_request: true,
    invalid_task: true,
    missing_history: true,
    missing_opening_cumulative: true,
    not_found: true,
    notification_retry_failed: true,
    opening_cumulative_mismatch: true,
    organization_not_found: true,
    payroll_policy_missing: true,
    payroll_policy_unavailable: true,
    payroll_policy_update_failed: true,
    payroll_update_failed: true,
    profile_save_failed: true,
    project_create_failed: true,
    project_create_forbidden: true,
    project_command_unavailable: true,
    scope_conflict: true,
    stale_version: true,
    project_member_invalid: true,
    task_create_failed: true,
    task_create_forbidden: true,
    task_batch_unavailable: true,
    task_transition_unavailable: true,
    version_conflict: true,
    invalid_transition: true,
    invalid_idempotency_key: true,
    task_not_found: true,
    task_update_failed: true,
  };
  var requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  var notificationErrorCodes = {
    token_unavailable: true,
    recipient_unavailable: true,
    send_failed: true,
    configuration_unavailable: true,
    queue_unavailable: true,
    delivery_unconfirmed: true,
  };

  function safeNotification(value) {
    var notification = value && typeof value === "object" ? value : {};
    var errorCode = typeof notification.errorCode === "string"
      && Object.prototype.hasOwnProperty.call(
        notificationErrorCodes,
        notification.errorCode,
      )
      ? notification.errorCode
      : "";
    if (errorCode === "delivery_unconfirmed" || errorCode === "queue_unavailable") {
      return { status: "failed", errorCode: errorCode };
    }
    if (errorCode === "recipient_unavailable") {
      return { status: "unavailable", errorCode: errorCode };
    }
    if (notification.status === "pending" || notification.status === "sent") {
      return { status: notification.status, errorCode: errorCode };
    }
    if (notification.status === "failed") {
      return { status: "failed", errorCode: errorCode || "send_failed" };
    }
    return {
      status: "unavailable",
      errorCode: errorCode || "recipient_unavailable",
    };
  }

  function loginUrl() {
    return "/login?next=" + encodeURIComponent(
      window.location.pathname + window.location.search,
    );
  }

  function redirectToLogin() {
    var target = loginUrl();
    try {
      window.location.assign(target);
    } catch (error) {
      void error;
      window.location.href = target;
    }
  }

  function bootstrapFailure(body) {
    var value = body && typeof body === "object" ? body : {};
    var requestedCode = typeof value.code === "string" ? value.code : "";
    var explicitCode = Object.prototype.hasOwnProperty.call(bootstrapErrorCodes, requestedCode);
    var code = explicitCode
      ? requestedCode
      : "workstation_unavailable";
    var error = new Error(code);
    error.code = code;
    if (explicitCode && typeof value.requestId === "string" && requestIdPattern.test(value.requestId)) {
      error.requestId = value.requestId;
    }
    return error;
  }

  function domainFailure(body) {
    var value = body && typeof body === "object" ? body : {};
    var valueCode = typeof value.error === "string" ? value.error
      : typeof value.code === "string" ? value.code : "";
    var code = Object.prototype.hasOwnProperty.call(domainErrorCodes, valueCode)
      ? valueCode
      : "workstation_unavailable";
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function handleJson(url, status, ok, body) {
    if (status === 401) {
      window.QUANTXY_WORKSTATION_AUTH_REQUIRED = true;
      window.setTimeout(redirectToLogin, 0);
      throw new Error("unauthorized");
    }
    if (!ok) {
      if (url === "/api/workstation/bootstrap") throw bootstrapFailure(body);
      throw domainFailure(body);
    }
    return body;
  }

  function readJson(url, response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      return handleJson(url, response.status, response.ok, body);
    });
  }

  function requestWithXhr(url, options) {
    return new Promise(function (resolve, reject) {
      var xhr = new window.XMLHttpRequest();
      xhr.open(options.method || "GET", url, true);
      xhr.withCredentials = true;
      Object.keys(options.headers || {}).forEach(function (name) {
        xhr.setRequestHeader(name, options.headers[name]);
      });
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var body = {};
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch (error) {
          void error;
          body = {};
        }
        try {
          resolve(handleJson(
            url,
            xhr.status,
            xhr.status >= 200 && xhr.status < 300,
            body,
          ));
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = function () {
        reject(new Error("workstation_unavailable"));
      };
      xhr.send(options.body || null);
    });
  }

  function request(url, init) {
    var options = init || {};
    options.credentials = "same-origin";
    options.cache = "no-store";
    if (typeof window.fetch === "function") {
      return window.fetch(url, options).then(function (response) {
        return readJson(url, response);
      });
    }
    if (typeof window.XMLHttpRequest === "function") {
      return requestWithXhr(url, options);
    }
    return Promise.reject(new Error("workstation_unavailable"));
  }

  var readyPromise = (embeddedBootstrap
    ? Promise.resolve(embeddedBootstrap)
    : request("/api/workstation/bootstrap")).then(function (data) {
    bootstrap = data;
    return data;
  });

  function requireBootstrap() {
    if (!bootstrap) throw new Error("workstation_not_ready");
    return bootstrap;
  }

  function taskRows(memberId, scope, status) {
    var rows = requireBootstrap().tasks || [];
    rows = rows.filter(function (task) {
      if (scope === "created") return task.createdBy === memberId;
      return task.own === memberId;
    });
    if (status === "已逾期") {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      rows = rows.filter(function (task) {
        return task.st !== "已完成" && task.e && new Date(task.e) < today;
      });
    } else if (status && status !== "all") {
      rows = rows.filter(function (task) { return task.st === status; });
    }
    return rows;
  }

  function myProjects(memberId) {
    var data = requireBootstrap();
    return (data.projects || []).filter(function (project) {
      return project.own === memberId || (data.tasks || []).some(function (task) {
        return task.p === project.id && task.own === memberId;
      });
    });
  }

  function replaceTask(task) {
    var rows = requireBootstrap().tasks || [];
    for (var index = 0; index < rows.length; index += 1) {
      if (rows[index].id === task.id) {
        rows[index] = Object.assign({}, rows[index], task);
        task = rows[index];
        break;
      }
    }
    return clone(task);
  }

  function addTask(task) {
    var rows = requireBootstrap().tasks || [];
    rows.unshift(task);
    return clone(task);
  }

  function addProject(project) {
    var rows = requireBootstrap().projects || [];
    rows.unshift(project);
    return clone(project);
  }

  function commandId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = Array.prototype.map.call(bytes, function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
        hex.slice(16, 20), hex.slice(20)].join("-");
    }
    throw new Error("workstation_unavailable");
  }

  function projectRow(project) {
    var value = project && typeof project === "object" ? project : {};
    var owner = (requireBootstrap().members || []).find(function (member) {
      return member.employeePublicId === value.ownerPublicId;
    });
    var moneyPattern = /^(0|[1-9]\d{0,15})\.\d{2}$/;
    var projectStatuses = { planning: true, active: true };
    var projectHealth = { on_track: true, at_risk: true, off_track: true };
    if (!owner || typeof value.id !== "string" || !requestIdPattern.test(value.id)
        || typeof value.ownerPublicId !== "string" || !requestIdPattern.test(value.ownerPublicId)
        || typeof value.name !== "string" || !value.name.trim()
        || typeof value.category !== "string" || !value.category.trim()
        || typeof value.budgetAmount !== "string" || !moneyPattern.test(value.budgetAmount)
        || !Number.isSafeInteger(value.version) || value.version < 1
        || typeof value.progress !== "number" || !Number.isFinite(value.progress)
        || value.progress < 0 || value.progress > 100
        || !Object.prototype.hasOwnProperty.call(projectStatuses, value.status)
        || !Object.prototype.hasOwnProperty.call(projectHealth, value.health)
        || typeof value.updatedAt !== "string" || !Number.isFinite(new Date(value.updatedAt).getTime())) {
      throw new Error("workstation_unavailable");
    }
    var statuses = { planning: "规划中", active: "进行中" };
    var health = { on_track: 90, at_risk: 65, off_track: 35 };
    return {
      id: value.id,
      n: value.name,
      own: owner.id,
      cat: value.category,
      pr: Number(value.progress) || 0,
      bud: Number(value.budgetAmount) / 10000,
      health: health[value.health] || 70,
      st: statuses[value.status] || "进行中",
      s: value.startsOn || "",
      e: value.dueOn || "",
      version: value.version,
      up: value.updatedAt,
    };
  }

  function definitiveCommandFailure(error, unavailableCode) {
    return !!(error && typeof error.code === "string"
      && error.code !== "workstation_unavailable"
      && error.code !== unavailableCode)
      || !!(error && error.message === "unauthorized");
  }

  function mutateTask(taskId, action, input) {
    var current = (requireBootstrap().tasks || []).find(function (task) { return task.id === taskId; });
    if (!current || !Number.isSafeInteger(current.version) || current.version < 1) {
      return Promise.reject(new Error("workstation_unavailable"));
    }
    var body = Object.assign({ action: action, expectedVersion: current.version }, input || {});
    var payload = JSON.stringify(body);
    var existing = taskTransitionAttempts[taskId];
    if (existing && existing.payload !== payload) {
      if (existing.promise) return Promise.reject(new Error("workstation_unavailable"));
      delete taskTransitionAttempts[taskId];
      existing = null;
    }
    if (!existing) {
      existing = { payload: payload, key: commandId(), promise: null };
      taskTransitionAttempts[taskId] = existing;
    }
    if (existing.promise) return existing.promise;
    var attempt = existing;
    attempt.promise = request("/api/workstation/tasks/" + encodeURIComponent(taskId), {
      method: "PATCH",
      headers: { "content-type": "application/json", "Idempotency-Key": attempt.key },
      body: payload,
    }).then(function (result) {
      var task = replaceTask(result.task);
      if (taskTransitionAttempts[taskId] === attempt) delete taskTransitionAttempts[taskId];
      return task;
    }).catch(function (error) {
      if (definitiveCommandFailure(error, "task_transition_unavailable")) {
        if (taskTransitionAttempts[taskId] === attempt) delete taskTransitionAttempts[taskId];
      } else if (taskTransitionAttempts[taskId] === attempt) {
        attempt.promise = null;
      }
      throw error;
    });
    return attempt.promise;
  }

  window.QUANTXY_WORKSTATION_RUNTIME = runtime;
  window.QUANTXY_WORKSTATION_SERVER_ADAPTER = {
    ready: function () { return readyPromise; },
    redirectToLogin: redirectToLogin,
    getSession: function () { return clone(requireBootstrap().session); },
    loadBootstrap: function () { return clone(requireBootstrap()); },
    loadMyDashboard: function (memberId) {
      var tasks = taskRows(memberId, "todo", "all");
      var reminders = tasks.filter(function (task) {
        return !!task.blocker || task.st === "待验收";
      });
      return clone({
        tasks: tasks,
        must: tasks.filter(function (task) { return task.st !== "已完成"; }).slice(0, 6),
        projects: myProjects(memberId).slice(0, 4),
        payroll: (requireBootstrap().payroll[memberId] || [])[0] || null,
        reminders: reminders.slice(0, 5),
      });
    },
    listMyTasks: function (memberId, scope, status) {
      return clone(taskRows(memberId, scope, status));
    },
    loadMyTask: function (memberId, taskId) {
      var permissions = requireBootstrap().session.permissions || [];
      var canManage = permissions.indexOf("task.manage") >= 0;
      var task = (requireBootstrap().tasks || []).find(function (row) {
        return row.id === taskId && (canManage
          || row.own === memberId
          || row.createdBy === memberId
          || row.reviewer === memberId);
      });
      return clone(task || null);
    },
    listMyProjects: function (memberId) { return clone(myProjects(memberId)); },
    loadPayroll: function (memberId) {
      return clone(requireBootstrap().payroll[memberId] || []);
    },
    loadPayrollPolicy: function () {
      return request("/api/workstation/payroll/policy", { method: "GET" });
    },
    savePayrollPolicy: function (input) {
      return request("/api/workstation/payroll/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input || {}),
      });
    },
    previewPayroll: function (input) {
      return request("/api/workstation/payroll/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input || {}),
      });
    },
    syncDirectory: function () {
      return request("/api/workstation/directory-sync", { method: "POST" });
    },
    createProject: function (input) {
      var payload = JSON.stringify(input || {});
      if (projectCreateAttempt && projectCreateAttempt.payload !== payload) {
        if (projectCreateAttempt.promise) return Promise.reject(new Error("workstation_unavailable"));
        projectCreateAttempt = null;
      }
      if (!projectCreateAttempt) {
        projectCreateAttempt = { payload: payload, key: commandId(), promise: null };
      }
      if (projectCreateAttempt.promise) return projectCreateAttempt.promise;
      var attempt = projectCreateAttempt;
      attempt.promise = request("/api/workstation/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: payload,
      }).then(function (result) {
        var created = addProject(projectRow(result.project));
        if (projectCreateAttempt === attempt) projectCreateAttempt = null;
        return created;
      }).catch(function (error) {
        var explicitFailure = error && typeof error.code === "string"
          && error.code !== "workstation_unavailable"
          && error.code !== "project_command_unavailable";
        if (explicitFailure || (error && error.message === "unauthorized")) {
          if (projectCreateAttempt === attempt) projectCreateAttempt = null;
        } else if (projectCreateAttempt === attempt) {
          attempt.promise = null;
        }
        throw error;
      });
      return attempt.promise;
    },
    createTask: function (input) {
      var payload = JSON.stringify(input || {});
      if (taskCreateAttempt && taskCreateAttempt.payload !== payload) {
        if (taskCreateAttempt.promise) return Promise.reject(new Error("workstation_unavailable"));
        taskCreateAttempt = null;
      }
      if (!taskCreateAttempt) taskCreateAttempt = { payload: payload, key: commandId(), promise: null };
      if (taskCreateAttempt.promise) return taskCreateAttempt.promise;
      var attempt = taskCreateAttempt;
      attempt.promise = request("/api/workstation/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": attempt.key },
        body: payload,
      }).then(function (result) {
        var task = addTask(result.task);
        task.notification = safeNotification(result.notification);
        if (taskCreateAttempt === attempt) taskCreateAttempt = null;
        return task;
      }).catch(function (error) {
        if (definitiveCommandFailure(error, "task_create_failed")) {
          if (taskCreateAttempt === attempt) taskCreateAttempt = null;
        } else if (taskCreateAttempt === attempt) {
          attempt.promise = null;
        }
        throw error;
      });
      return attempt.promise;
    },
    createTasks: function (inputs) {
      var payload = JSON.stringify({ tasks: Array.isArray(inputs) ? inputs : [] });
      if (taskBatchAttempt && taskBatchAttempt.payload !== payload) {
        if (taskBatchAttempt.promise) return Promise.reject(new Error("workstation_unavailable"));
        taskBatchAttempt = null;
      }
      if (!taskBatchAttempt) taskBatchAttempt = { payload: payload, key: commandId(), promise: null };
      if (taskBatchAttempt.promise) return taskBatchAttempt.promise;
      var attempt = taskBatchAttempt;
      attempt.promise = request("/api/workstation/tasks/batch", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": attempt.key },
        body: payload,
      }).then(function (result) {
        var tasks = (Array.isArray(result.tasks) ? result.tasks : []).map(function (row) {
          var task = addTask(row.task);
          task.notification = safeNotification(row.notification);
          return task;
        });
        if (taskBatchAttempt === attempt) taskBatchAttempt = null;
        return tasks;
      }).catch(function (error) {
        if (definitiveCommandFailure(error, "task_batch_unavailable")) {
          if (taskBatchAttempt === attempt) taskBatchAttempt = null;
        } else if (taskBatchAttempt === attempt) {
          attempt.promise = null;
        }
        throw error;
      });
      return attempt.promise;
    },
    retryTaskNotification: function (taskId) {
      return request(
        "/api/workstation/tasks/" + encodeURIComponent(taskId) + "/notify",
        { method: "POST" },
      ).then(function (result) {
        return safeNotification(result.notification);
      });
    },
    savePayroll: function (input) {
      return request("/api/workstation/payroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input || {}),
      }).then(function (result) {
        var data = requireBootstrap();
        if (result.payroll && result.memberId === data.session.memberId) {
          data.payroll[result.memberId] = [result.payroll]
            .concat(data.payroll[result.memberId] || [])
            .filter(function (row, index, rows) {
              return rows.findIndex(function (candidate) {
                return candidate.month === row.month;
              }) === index;
            });
        }
        return clone(result);
      });
    },
    saveWorkProfile: function (input) {
      return request("/api/workstation/work-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input || {}),
      }).then(function (result) {
        var profile = result.profile || {};
        var memberId = requireBootstrap().session.memberId;
        var member = (requireBootstrap().members || []).find(function (row) {
          return row.id === memberId;
        });
        if (member) member.workProfile = clone(profile);
        return clone(profile);
      });
    },
    saveTask: function (taskId, input) { return mutateTask(taskId, "progress", input); },
    claimTask: function (taskId) { return mutateTask(taskId, "claim"); },
    updateTaskExecution: function (taskId, input) { return mutateTask(taskId, "progress", input); },
    submitTaskResult: function (taskId, input) { return mutateTask(taskId, "submit", input); },
    reviewTaskResult: function (taskId, input) { return mutateTask(taskId, "review", input); },
    reopenTask: function (taskId, note) { return mutateTask(taskId, "reopen", { note: note || "" }); },
    logout: function () {
      return request("/api/auth/logout", { method: "POST" })
        .catch(function () { return {}; })
        .then(function () { window.location.assign(loginUrl()); });
    },
  };
})(window);
