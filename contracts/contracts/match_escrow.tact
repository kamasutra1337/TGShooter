import "@stdlib/deploy";

// MatchEscrow — holds wager stakes for TG Shooter matches and pays the pot to the
// winner reported by the authoritative game server (the "oracle").
//
// Money-safety model:
//   - Players deposit `stake` for a `matchId`. The contract accumulates the pot.
//   - Only the oracle (owner = the authoritative server's key) can settle a match,
//     paying the winner `pot * (1 - rake)`. The client can never move funds.
//   - Only the oracle can cancel, refunding every player their stake.
//   - Settlement is one-shot: a match can be settled or cancelled exactly once.
//
// A single deployed contract serves many matches (keyed by matchId).

struct MatchData {
    organizer: Address;
    stake: Int as coins;
    seats: Int as uint8;
    count: Int as uint8;
    pot: Int as coins;
    settled: Bool;
}

message Deposit {
    matchId: Int as uint64;
    stake: Int as coins;
    seats: Int as uint8;
}

message Settle {
    matchId: Int as uint64;
    winner: Address;
}

message CancelMatch {
    matchId: Int as uint64;
}

message Withdraw {
    amount: Int as coins;
}

const MAX_SEATS: Int = 16;

contract MatchEscrow with Deployable {
    owner: Address; // oracle = authoritative game server
    rakeBps: Int as uint16; // house rake in basis points (500 = 5%)
    matches: map<Int, MatchData>;
    players: map<Int, Address>; // key = matchId * MAX_SEATS + seatIndex

    init(owner: Address, rakeBps: Int) {
        require(rakeBps <= 2000, "rake too high");
        self.owner = owner;
        self.rakeBps = rakeBps;
    }

    receive(msg: Deposit) {
        let ctx: Context = context();

        let existing: MatchData? = self.matches.get(msg.matchId);
        let data: MatchData = existing != null
            ? existing!!
            : MatchData{
                organizer: ctx.sender,
                stake: msg.stake,
                seats: msg.seats,
                count: 0,
                pot: 0,
                settled: false,
            };

        if (existing == null) {
            require(msg.seats >= 2 && msg.seats < MAX_SEATS, "bad seats");
            require(msg.stake > 0, "bad stake");
        }

        require(!data.settled, "already settled");
        require(data.count < data.seats, "room full");
        require(ctx.value >= data.stake, "insufficient stake");

        // record the player for potential refunds
        let key: Int = msg.matchId * MAX_SEATS + data.count;
        self.players.set(key, ctx.sender);

        data.count = data.count + 1;
        data.pot = data.pot + data.stake;
        self.matches.set(msg.matchId, data);
    }

    receive(msg: Settle) {
        require(sender() == self.owner, "not oracle");
        let existing: MatchData? = self.matches.get(msg.matchId);
        require(existing != null, "no match");
        let data: MatchData = existing!!;
        require(!data.settled, "already settled");

        data.settled = true;
        self.matches.set(msg.matchId, data);

        let payout: Int = data.pot * (10000 - self.rakeBps) / 10000;
        send(SendParameters{
            to: msg.winner,
            value: payout,
            mode: SendIgnoreErrors,
            bounce: false,
        });
    }

    receive(msg: CancelMatch) {
        require(sender() == self.owner, "not oracle");
        let existing: MatchData? = self.matches.get(msg.matchId);
        require(existing != null, "no match");
        let data: MatchData = existing!!;
        require(!data.settled, "already settled");

        data.settled = true;
        self.matches.set(msg.matchId, data);

        // refund each recorded player their stake
        let i: Int = 0;
        while (i < data.count) {
            let key: Int = msg.matchId * MAX_SEATS + i;
            let p: Address? = self.players.get(key);
            if (p != null) {
                send(SendParameters{
                    to: p!!,
                    value: data.stake,
                    mode: SendIgnoreErrors,
                    bounce: false,
                });
            }
            i = i + 1;
        }
    }

    // Owner withdraws accumulated rake (contract balance above rent).
    receive(msg: Withdraw) {
        require(sender() == self.owner, "not oracle");
        send(SendParameters{
            to: self.owner,
            value: msg.amount,
            mode: SendIgnoreErrors,
            bounce: false,
        });
    }

    get fun matchData(matchId: Int): MatchData? {
        return self.matches.get(matchId);
    }

    get fun rake(): Int {
        return self.rakeBps;
    }

    get fun owner(): Address {
        return self.owner;
    }
}
