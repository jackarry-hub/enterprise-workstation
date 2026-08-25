(function installFormalWorkstationAdapter(window) {
  "use strict";

  if (window.location.protocol === "file:") return;
  try {
    if (new URLSearchParams(window.location.search).get("formal") !== "1") return;
  } catch {
    return;
  }

  var bootstrap = null;
  var runtime = { authMode: "feishu", dataMode: "server" };

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
    window.location.assign(loginUrl());
  }

  function readJson(response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (response.status === 401) {
        redirectToLogin();
        throw new Error("unauthorized");
      }
      if (!response.ok) throw new Error(body.error || "workstation_unavailable");
      return body;
    });
  }

  function request(url, init) {
    var options = init || {};
    options.credentials = "same-origin";
    options.cache = "no-store";
    return window.fetch(url, options).then(readJson);
  }

  var readyPromise = request("/api/workstation/bootstrap").then(function (data) {
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
