window.BJ = window.BJ || {};
window.BJ.dropboxModule = function(ctx) {

	async function runDropboxBackup() {
		if (!ctx.highlightsBackup.accessToken) {return;}
		let date = new Date().toJSON().slice(0,10);
		if (date != ctx.highlightsBackup.lastBackup) {
			let data = await ctx.getAllHighlights();
			let dbxAuth = new Dropbox.DropboxAuth({
				clientId: ctx.DROPBOX_CLIENT_ID,
			});
			dbxAuth.setAccessToken(ctx.highlightsBackup.accessToken);
			dbxAuth.setRefreshToken(ctx.highlightsBackup.refreshToken);
			let dbx = new Dropbox.Dropbox({
				auth: dbxAuth
			});
			let r = await dbx.filesUpload({
				path: '/' + ctx.highlightsBackup.filename /* + " " + date */ + ".json",
				contents: data,
				mode: {".tag": "overwrite"},
			});
			console.log("Backup to Dropbox done", r);
			const status = r.status == 200 ? "success" : "error " + r.status
			ctx.showStatusMessage(`Highlights have been backed up to Dropbox (${status})`);
			ctx.highlightsBackup.lastBackup = date;
			await ctx.setStorage("highlightsBackup", ctx.highlightsBackup);
		}
	}

	return { runDropboxBackup };
};
