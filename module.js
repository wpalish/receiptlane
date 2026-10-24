import {
  F,
  S,
  R,
  C,
  live,
  rows,
  byId,
  unique,
  required,
  minor,
  amount,
  interval,
  noOverlap,
  changed,
  immutable,
  admin,
  totalLines,
  summary,
  clock,
  label,
} from "./core/rules.js";
const definition = {
  slug: "receiptlane",
  reference: 65,
  title: "ReceiptLane",
  description:
    "Сбор и согласование отчётов о расходах с ручными ссылками на подтверждения. OCR и банковских списаний нет.",
  limitations:
    "Одна организация · Собственный сервер · Ручной ввод · Без банковских и внешних интеграций",
  collections: [
    C("reports", "Отчёты", [
      F("name", "Название"),
      S("currency", "Валюта", ["KZT", "USD", "KGS", "UZS"]),
      F("period", "Дата отчёта", "date"),
      S("status", "Состояние", [
        ["draft", "Черновик"],
        ["submitted", "На согласовании"],
        ["approved", "Согласован"],
        ["reimbursed", "Возмещение отмечено"],
      ]),
    ]),
    C("expenses", "Расходы", [
      R("report", "Отчёт", "reports"),
      F("vendor", "Поставщик"),
      F("date", "Дата", "date"),
      F("amount", "Сумма", "money"),
      F("evidence", "Номер/ссылка подтверждения", "textarea"),
    ]),
  ],
  validate(state, before, command, actor) {
    for (const report of rows(state, "reports")) {
      const old = changed(before, "reports", report.id),
        items = live(state, "expenses").filter((x) => x.report === report.id);
      if (report.status !== "draft") required(items.length > 0, "Отчёт пуст.");
      if (old?.status === "reimbursed")
        immutable(old, report, [
          "name",
          "currency",
          "period",
          "status",
          "archived",
        ]);
      if (old && old.status !== "draft" && report.status !== "draft")
        immutable(old, report, ["currency", "period"]);
      if (old && report.status !== old.status) {
        if (report.status === "approved") {
          admin(actor);
          required(
            old.status === "submitted" && old.createdBy !== actor.name,
            "Нужно согласовать отчёт другого сотрудника после отправки.",
          );
        }
        if (report.status === "reimbursed") {
          admin(actor);
          required(old.status === "approved", "Сначала согласуйте отчёт.");
        }
        if (old.status === "reimbursed")
          required(false, "История возмещения сохраняется неизменной.");
      }
      if (!old)
        required(
          report.status === "draft",
          "Новый отчёт создаётся черновиком.",
        );
    }
    for (const e of rows(state, "expenses")) {
      required(minor(e.amount) > 0, "Расход должен быть положительным.");
      const report = byId(state, "reports", e.report),
        old = changed(before, "expenses", e.id);
      if (report.status !== "draft")
        required(
          old && JSON.stringify(old) === JSON.stringify(e),
          "Верните отчёт в черновик перед правкой расходов.",
        );
    }
  },
  summarize(state) {
    return rows(state, "reports").map((r) =>
      summary(
        r.name + " · " + r.currency,
        "Расходов: " +
          live(state, "expenses").filter((x) => x.report === r.id).length,
        "Итого: " +
          amount(
            live(state, "expenses")
              .filter((x) => x.report === r.id)
              .reduce((s, x) => s + minor(x.amount), 0),
          ),
        "Статус: " +
          label(definition, "reports", "status", r.status) +
          "; это учётная отметка, не банковская операция.",
      ),
    );
  },
};
export default definition;
