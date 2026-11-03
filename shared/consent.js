// Einverständnis «E-Mail-Beleg» (ab 1.2.0, Datenschutz): Eine E-Mail-Adresse
// wird nur dauerhaft gespeichert — beim Kunden und auf der Quittung —, wenn
// der Kunde zugestimmt hat. Ohne Zustimmung lässt sich der Beleg trotzdem per
// E-Mail schicken; die Adresse dient dann nur diesem einen Versand.
//
// Kunden aus Version 1.1 kennen das Feld nicht. Ihre gespeicherte Adresse
// bleibt erhalten (kein Datenverlust), gilt aber als "Einverständnis fehlt":
// Sie wird nicht mehr auf neue Quittungen übernommen, und die Kundenliste
// bietet an, das Einverständnis zu erfassen oder die Adresse zu entfernen.
//
// emailConsent: { given: true, at: "JJJJ-MM-TT" } | null

export function hasEmailConsent(person) {
  return person?.emailConsent?.given === true;
}

export function grantEmailConsent(person, dateISO) {
  return { ...person, emailConsent: { given: true, at: dateISO } };
}

// Form zum Speichern: ohne Einverständnis keine Adresse.
export function withoutUnconsentedEmail(person) {
  if (!person) return person;
  if (hasEmailConsent(person) || !person.email) return person;
  return { ...person, email: "" };
}

// Grobe Prüfung einer E-Mail-Adresse vor dem Versand (dieselbe Regel wie in
// desktop/mailer.js, das vor dem Senden noch einmal prüft).
export function isValidEmail(address) {
  return /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(String(address || "").trim());
}

// Gespeicherte Adresse aus der Zeit vor dem Einverständnis-Feld.
export function hasLegacyEmailWithoutConsent(person) {
  return !!person?.email && !hasEmailConsent(person);
}
