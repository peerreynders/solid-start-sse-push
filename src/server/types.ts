type User = {
	id: string;
	email: string;
};

type Password = {
	hash: string;
	userId: string;
};

type FxPairList = {
	fxPairs: string[];
	userId: string;
};

type Data = {
	users: User[];
	fxPairLists: FxPairList[];
	passwords: Password[];
};

type SeedContent = [email: string, password: string, fxPairs: string[]][];

export type { Data, FxPairList, Password, SeedContent, User };
