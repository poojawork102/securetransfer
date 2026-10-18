import { TEAM } from "../../utils/constants";
import "./TeamTab.css";

export default function TeamTab() {
  return (
    <div className="team-tab">
      <section className="card">
        <h3>Team members</h3>
        <table className="team-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>PRN</th>
              <th>Panel</th>
              <th>Files owned</th>
              <th>Viva topics</th>
            </tr>
          </thead>
          <tbody>
            {TEAM.map((m, i) => (
              <tr key={i}>
                <td><strong>{m.name}</strong></td>
                <td className="mono">{m.prn || "..."}</td>
                <td>{m.panel || "..."}</td>
                <td className="muted">See CONTRIBUTIONS.md</td>
                <td className="muted">See VIVA_NOTES.md</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>AI usage declaration</h3>
        <p style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
          Parts of this project were developed with assistance from Claude (Anthropic).
          All code was reviewed, tested, and understood by the team members.
          Each member can independently explain and modify their assigned files.
        </p>
      </section>

      <section className="card">
        <h3>References</h3>
        <ol className="references" style={{ paddingLeft: 20, fontSize: "0.85rem", lineHeight: 1.8 }}>
          <li>J. Postel, "Transmission Control Protocol," RFC 793, IETF, Sep. 1981.</li>
          <li>R. Braden, D. Borman, C. Partridge, "Computing the Internet Checksum," RFC 1071, IETF, Sep. 1988.</li>
          <li>R. W. Hamming, "Error Detecting and Error Correcting Codes," Bell System Technical Journal, vol. 29, no. 2, pp. 147-160, Apr. 1950.</li>
          <li>W. Peterson, D. Brown, "Cyclic Codes for Error Detection," Proceedings of the IRE, vol. 49, no. 1, pp. 228-235, Jan. 1961.</li>
          <li>H. Krawczyk, M. Bellare, R. Canetti, "HMAC: Keyed-Hashing for Message Authentication," RFC 2104, IETF, Feb. 1997.</li>
          <li>NIST, "Secure Hash Standard (SHS)," FIPS PUB 180-4, Aug. 2015.</li>
          <li>V. Paxson, M. Allman, J. Chu, M. Sargent, "Computing TCP's Retransmission Timer," RFC 6298, IETF, Jun. 2011.</li>
        </ol>
      </section>
    </div>
  );
}
