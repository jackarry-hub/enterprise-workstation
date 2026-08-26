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
    project_member_invalid: true,
    task_create_failed: true,
    task_create_forbidden: true,
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
    var code = typeof value.code === "string" && bootstrapErrorCodes[value.code]
      ? value.code
      : "workstation_unavailable";
    var error = new Error(code);
    error.code = code;
    if (typeof value.requestId === "string" && requestIdPattern.test(value.requestId)) {
      error.requestId = value.requestId;
    }
    return error;
  }

  function domainFailure(body) {
    var value = body && typeof body === "object" ? body : {};
    var valueCode = typeof value.error === "string" ? value.error
      : typeof value.code === "string" ? value.code : "";
    var code = domainErrorCodes[valueCode] ? valueCode : "workstation_unavailable";
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

  function mutateTask(taskId, action, input) {
    return request("/api/workstation/tasks/" + encodeURIComponent(taskId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, input || {})),
    }).then(function (result) { return replaceTask(result.task); });
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
      return request("/api/workstation/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input || {}),
      }).then(function (result) {
        return addProject(result.project);
      });
    },
    createTask: function (input) {
      return request("/api/workstation/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input || {}),
      }).then(function (result) {
        var task = addTask(result.task);
        task.notification = safeNotification(result.notification);
        return task;
      });
    },
    createTasks: function (inputs) {
      return request("/api/workstation/tasks/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tasks: Array.isArray(inputs) ? inputs : [] }),
      }).then(function (result) {
        return (Array.isArray(result.tasks) ? result.tasks : []).map(function (row) {
          var task = addTask(row.task);
          task.notification = safeNotification(row.notification);
          return task;
        });
      });
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
