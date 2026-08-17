# Using LNORI.com with LNReader

This guide shows how to add the plugin repository for this project to LNReader and install the **LNORI.com** source.

## 1. Install LNReader

Install LNReader for Android from the official LNReader release page:

https://github.com/lnreader/lnreader/releases

LNReader supports Android 7.0 and newer.

## 2. Add the plugin repository

LNReader 2.x uses plugin repositories. Open the plugin/repository management screen in LNReader and add this repository manifest:

```text
https://raw.githubusercontent.com/5ghzx/novelarchive-lnreader/plugins/master/.dist/plugins.min.json
```

If your LNReader build asks for a repository URL, use the URL above.

## 3. Install LNORI.com

After adding the repository, refresh the repository list. Find **LNORI.com** and install it.

This is the LNORI.com plugin maintained in this repository. It is separate from the official LNReader LNORI plugin and is intended to provide a sequential implementation of LNORI volume fetching.

The repository is maintained at:

https://github.com/5ghzx/novelarchive-lnreader

## 4. Search and read

Open LNReader's source/search interface, select **LNORI.com**, and search for a novel. Open a result to view its available chapters and start reading.

## 5. Updating

When this repository publishes a newer plugin build, refresh the plugin repository in LNReader and update **LNORI.com** if an update is offered.

### Repository

https://github.com/5ghzx/novelarchive-lnreader

### LNORI.com

https://lnori.com/

### Official LNReader

https://github.com/lnreader/lnreader

LNReader is not affiliated with LNORI.com or this repository.
